// Unified usage ledger — the single source of truth for Today / Month / All-time
// and per-device consumption.
//
// The router exposes cumulative byte counters (per WiFi client and per LAN port)
// that only reset on a reboot. We accumulate the *bounded, reset-aware delta* of
// those counters into a day+scope ledger:
//
//   - normal:        delta = cur - prev
//   - reset (cur<prev): delta = 0           (a reboot/reconnect — NOT the whole counter)
//   - first sighting:   delta = 0           (baseline only; never count history as "today")
//
// The old approach replayed samples through `bdelta` which added `Math.max(0,cur)`
// on every reset — dumping the entire counter as phantom GBs. This module fixes
// that. Because the counters are cumulative, a normal delta also correctly recovers
// traffic the router metered while the collector was down — that catch-up is
// attributed to the scope that earned it (the day it lands on is approximate when
// the collector missed polls; it's exact while the collector runs continuously).
//
// `__unattributed__` is reserved for future counter-vs-ledger calibration; the
// accumulator does not write to it today.
//
// Direction convention (verified, matches per-device speed + the gauge):
//   WiFi client: download = RXBytes, upload = TXBytes
//   LAN port:    download = OutBytes, upload = InBytes

/** Local-timezone day bucket 'YYYY-MM-DD' for an epoch-ms timestamp. */
export function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${da}`;
}

let cache = null;
function stmts(db) {
  if (cache && cache.db === db) return cache;
  cache = {
    db,
    getState: db.prepare("SELECT last_down, last_up, last_ts FROM scope_state WHERE scope = ?"),
    setState: db.prepare(`
      INSERT INTO scope_state (scope, kind, last_down, last_up, last_ts)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        kind = excluded.kind, last_down = excluded.last_down,
        last_up = excluded.last_up, last_ts = excluded.last_ts`),
    addDaily: db.prepare(`
      INSERT INTO usage_daily (day, scope, kind, down_bytes, up_bytes, updated_ts)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, scope) DO UPDATE SET
        down_bytes = down_bytes + excluded.down_bytes,
        up_bytes   = up_bytes   + excluded.up_bytes,
        updated_ts = excluded.updated_ts`),
  };
  return cache;
}

/**
 * Fold one scope's cumulative counters at time `ts` into the ledger.
 * `curDown`/`curUp` are the cumulative download/upload byte counters.
 */
function step(db, ts, scope, kind, curDown, curUp) {
  if (curDown == null && curUp == null) return;
  const s = stmts(db);
  const prev = s.getState.get(scope);

  let dDown = 0,
    dUp = 0;
  if (prev && prev.last_ts != null && ts > prev.last_ts) {
    if (curDown != null && prev.last_down != null && curDown >= prev.last_down) dDown = curDown - prev.last_down;
    if (curUp != null && prev.last_up != null && curUp >= prev.last_up) dUp = curUp - prev.last_up;
  }

  // Advance the baseline even when ts <= last_ts (replay) so we never count
  // history twice; in that case dDown/dUp stay 0 above.
  s.setState.run(scope, kind, curDown ?? prev?.last_down ?? null, curUp ?? prev?.last_up ?? null, ts);

  if (dDown > 0 || dUp > 0) s.addDaily.run(dayKey(ts), scope, kind, dDown, dUp, ts);
}

/**
 * Accumulate one poll cycle into the ledger. Call inside saveSnapshot's
 * transaction. `devices` carry WiFi RX/TX counters; `ports` carry LAN in/out.
 */
export function accumulate(db, { ts, devices = [], ports = [] }) {
  for (const d of devices) {
    if (d.conn_type === "wifi" && d.mac) step(db, ts, d.mac, "wifi", d.rx_bytes, d.tx_bytes);
  }
  for (const p of ports) {
    if (p.port) step(db, ts, p.port, "port", p.out_bytes, p.in_bytes);
  }
}

/**
 * One-time backfill: rebuild the ledger from existing raw samples using the
 * fixed bounded-delta logic, so historical (inflated) numbers are recomputed
 * correctly. Idempotent — guarded by a flag in `meta`.
 */
const BACKFILL_FLAG = "ledger_backfill_v2"; // bump to force a one-time rebuild after logic changes
export function backfill(db) {
  if (db.prepare("SELECT value FROM meta WHERE key = ?").get(BACKFILL_FLAG)) return false;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM usage_daily; DELETE FROM scope_state;");
    cache = null; // statements are recreated against this db on next use

    for (const r of db
      .prepare("SELECT ts, mac, rx_bytes, tx_bytes FROM device_sample WHERE conn_type = 'wifi' AND mac IS NOT NULL ORDER BY ts")
      .all())
      step(db, r.ts, r.mac, "wifi", r.rx_bytes, r.tx_bytes);

    for (const r of db
      .prepare("SELECT ts, port, out_bytes, in_bytes FROM port_sample WHERE port IS NOT NULL ORDER BY ts")
      .all())
      step(db, r.ts, r.port, "port", r.out_bytes, r.in_bytes);

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(BACKFILL_FLAG, String(ts_now()));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return true;
}

// Date.now() isolated so the rest of the module stays a pure function of inputs.
function ts_now() {
  return Date.now();
}
