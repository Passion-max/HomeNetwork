// Cloud mirror — the ONLY module that talks to an external service. Local SQLite
// stays the primary writer; this pushes an eventually-consistent copy to Supabase
// so a hosted dashboard can read from anywhere. Dependency-free: raw fetch against
// Supabase's PostgREST API. Entirely OFF unless SUPABASE_URL + SUPABASE_SERVICE_KEY
// + HOME_ID are set, so pure-local installs are unaffected.
//
// Sync is watermark-based and idempotent (upserts), so it self-heals after the
// home loses internet — it simply pushes whatever changed since it last succeeded.
import { db } from "../db.mjs";
import { getState, getThroughputHistory } from "../queries.mjs";

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const HOME_ID = process.env.HOME_ID;
const TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS ?? 15000);

export function syncEnabled() {
  return !!(BASE && KEY && HOME_ID);
}

async function upsert(table, onConflict, rows) {
  if (!rows.length) return;
  const res = await fetch(`${BASE}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${table} upsert ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

const getMeta = (k) => db.prepare("SELECT value FROM meta WHERE key=?").get(k)?.value ?? null;
const setMeta = (k, v) => db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)").run(k, String(v));
const maxBy = (rows, f) => rows.reduce((m, r) => Math.max(m, f(r) ?? 0), 0);

/** Push everything that changed since the last successful sync. */
export async function syncOnce() {
  if (!syncEnabled()) return;
  const home_id = HOME_ID;

  // 1) Latest computed live state (covers Home / Devices / Health tabs).
  const state = getState();
  if (state) {
    await upsert("home_state", "home_id", [{ home_id, ts: state.ts, state_json: state, updated_ts: Date.now() }]);
  }

  // 2) usage_daily rows changed since the watermark.
  const uwm = Number(getMeta("sync_usage_wm") ?? 0);
  const uRows = db
    .prepare("SELECT day,scope,kind,down_bytes,up_bytes,updated_ts FROM usage_daily WHERE updated_ts > ? ORDER BY updated_ts LIMIT 5000")
    .all(uwm);
  if (uRows.length) {
    await upsert("usage_daily", "home_id,day,scope", uRows.map((r) => ({ home_id, ...r })));
    setMeta("sync_usage_wm", maxBy(uRows, (r) => r.updated_ts));
  }

  // 3) Devices changed since the watermark (last_seen).
  const dwm = Number(getMeta("sync_device_wm") ?? 0);
  const dRows = db
    .prepare("SELECT mac,hostname,custom_name,conn_type,port,first_seen,last_seen FROM device WHERE last_seen > ? ORDER BY last_seen LIMIT 5000")
    .all(dwm);
  if (dRows.length) {
    await upsert("device", "home_id,mac", dRows.map((r) => ({ home_id, ...r })));
    setMeta("sync_device_wm", maxBy(dRows, (r) => r.last_seen));
  }

  // 4) New throughput points for the history chart.
  const twm = Number(getMeta("sync_tput_wm") ?? 0);
  const pts = getThroughputHistory(60).filter((p) => p.ts > twm);
  if (pts.length) {
    await upsert("throughput", "home_id,ts", pts.map((p) => ({ home_id, ts: p.ts, down_kbps: p.down_kbps, up_kbps: p.up_kbps })));
    setMeta("sync_tput_wm", maxBy(pts, (p) => p.ts));
  }
}

let timer = null;
/** Start the periodic mirror. No-op (returns false) when not configured. */
export function startSync(intervalMs = Number(process.env.SYNC_INTERVAL_MS ?? 30000)) {
  if (!syncEnabled() || timer) return false;
  const run = () => syncOnce().catch((e) => console.error("sync error:", e.message));
  run();
  timer = setInterval(run, intervalMs);
  return true;
}
