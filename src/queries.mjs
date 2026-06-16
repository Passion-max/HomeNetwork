// Read helpers over the SQLite history. Live speeds come from sample deltas; all
// cumulative usage (Today/Month/All-time, per-device) comes from the unified ledger.
import { db } from "./db.mjs";
import { dayKey } from "./ledger.mjs";

const twoLatestTs = () =>
  db.prepare("SELECT ts FROM snapshot ORDER BY ts DESC LIMIT 2").all().map((r) => r.ts);

/** Rate in kbps between two cumulative byte readings. */
const kbps = (cur, prev, dtMs) =>
  cur == null || prev == null || !dtMs || cur < prev ? 0 : Math.round(((cur - prev) * 8) / (dtMs / 1000) / 1000);

/** "LAN3" -> "DEV.ETH.IF3" so we can attribute a wired port's traffic to its device. */
const lanToIf = (port) => {
  const n = /(\d+)/.exec(port ?? "")?.[1];
  return n ? `DEV.ETH.IF${n}` : null;
};

/** Today's usage per scope (mac or 'DEV.ETH.IFx') from the unified ledger. */
function todayUsageByScope() {
  const day = dayKey(Date.now());
  const map = {};
  for (const r of db.prepare("SELECT scope, down_bytes, up_bytes FROM usage_daily WHERE day = ?").all(day))
    map[r.scope] = { down: r.down_bytes, up: r.up_bytes };
  return map;
}

/** Full current state: system, WAN, devices (with live speed), totals. */
export function getState() {
  const [ts2, ts1] = twoLatestTs();
  if (!ts2) return null;
  const dtMs = ts1 ? ts2 - ts1 : 0;

  const snap = db.prepare("SELECT * FROM snapshot WHERE ts = ?").get(ts2);

  const cur = db
    .prepare(
      `SELECT s.*, d.custom_name, d.hostname AS dev_hostname, d.port AS dev_port, d.first_seen, d.blocked
       FROM device_sample s LEFT JOIN device d ON d.mac = s.mac WHERE s.ts = ?`,
    )
    .all(ts2);
  const prev = new Map(
    (ts1 ? db.prepare("SELECT * FROM device_sample WHERE ts = ?").all(ts1) : []).map((r) => [r.mac, r]),
  );

  const usage = todayUsageByScope();

  // Port samples (for wired-device live speed + total throughput).
  const curPorts = db.prepare("SELECT * FROM port_sample WHERE ts = ?").all(ts2);
  const curPortMap = new Map(curPorts.map((r) => [r.port, r]));
  const prevPorts = new Map(
    (ts1 ? db.prepare("SELECT * FROM port_sample WHERE ts = ?").all(ts1) : []).map((r) => [r.port, r]),
  );

  const devices = cur.map((s) => {
    const p = prev.get(s.mac);
    const u = s.conn_type === "wifi" ? usage[s.mac] : usage[lanToIf(s.dev_port)];

    // Live speed: WiFi from per-device counters; wired from its LAN port
    // (port out-bytes = the device's download, in-bytes = its upload).
    let down, up;
    if (s.conn_type === "wifi") {
      down = kbps(s.rx_bytes, p?.rx_bytes, dtMs);
      up = kbps(s.tx_bytes, p?.tx_bytes, dtMs);
    } else {
      const port = lanToIf(s.dev_port);
      const cp = curPortMap.get(port), pp = prevPorts.get(port);
      down = kbps(cp?.out_bytes, pp?.out_bytes, dtMs);
      up = kbps(cp?.in_bytes, pp?.in_bytes, dtMs);
    }
    return {
      mac: s.mac,
      name: s.custom_name || s.dev_hostname || s.mac,
      hostname: s.dev_hostname,
      ip: s.ip,
      conn_type: s.conn_type,
      ssid: s.ssid,
      band: s.band,
      rssi: s.rssi,
      snr: s.snr,
      signal: signalLabel(s.rssi),
      down_kbps: down,
      up_kbps: up,
      used_down_bytes: u?.down ?? 0,
      used_up_bytes: u?.up ?? 0,
      link_time_s: s.link_time_s,
      blocked: !!s.blocked,
      first_seen: s.first_seen,
    };
  });

  // Total throughput from active port deltas. Convention (same as per-device /
  // used-today): a LAN port's OUT bytes = the device's download, IN = its upload.
  let totalDown = 0,
    totalUp = 0;
  for (const port of curPorts) {
    const pp = prevPorts.get(port.port);
    totalDown += kbps(port.out_bytes, pp?.out_bytes, dtMs);
    totalUp += kbps(port.in_bytes, pp?.in_bytes, dtMs);
  }

  // Network name from connected Wi-Fi clients (strip trailing band digit:
  // "Passion Network 5" -> "Passion Network").
  const ssidCounts = {};
  for (const s of cur) if (s.ssid) { const b = s.ssid.replace(/\s+\d$/, ""); ssidCounts[b] = (ssidCounts[b] || 0) + 1; }
  const network = Object.entries(ssidCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    ts: ts2,
    network,
    system: {
      uptime_s: snap.uptime_s,
      cpu_pct: snap.cpu_pct,
      mem_pct: snap.mem_pct,
      flash_pct: snap.flash_pct,
      optical_temp_c: snap.optical_temp_c,
      optical_rx_dbm: snap.optical_rx_dbm,
      optical_tx_dbm: snap.optical_tx_dbm,
    },
    wan: { connected: !!snap.wan_connected, ip: snap.wan_ip, online_s: snap.wan_online_s },
    totals: {
      down_kbps: totalDown,
      up_kbps: totalUp,
      devices_online: devices.length,
      used_today_down_bytes: devices.reduce((a, d) => a + d.used_down_bytes, 0),
      used_today_up_bytes: devices.reduce((a, d) => a + d.used_up_bytes, 0),
    },
    devices: devices.sort((a, b) => b.down_kbps + b.up_kbps - (a.down_kbps + a.up_kbps)),
  };
}

/** Usage over windows (today / month / all-time), from the unified ledger. */
export function getUsageWindows() {
  return getConsumption().windows;
}

/** Per-device throughput + signal history for the device detail view. */
export function getDeviceHistory(mac, minutes = 30) {
  const since = Date.now() - minutes * 60_000;
  const rows = db
    .prepare("SELECT ts,rx_bytes,tx_bytes,rssi FROM device_sample WHERE mac=? AND ts>=? ORDER BY ts")
    .all(mac, since);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const dt = rows[i].ts - rows[i - 1].ts;
    out.push({
      ts: rows[i].ts,
      down_kbps: kbps(rows[i].rx_bytes, rows[i - 1].rx_bytes, dt),
      up_kbps: kbps(rows[i].tx_bytes, rows[i - 1].tx_bytes, dt),
      rssi: rows[i].rssi,
    });
  }
  return out;
}

/** Throughput history (total kbps) over the last N minutes for the speed graph. */
export function getThroughputHistory(minutes = 60) {
  const since = Date.now() - minutes * 60_000;
  const rows = db.prepare("SELECT ts, in_bytes, out_bytes, port FROM port_sample WHERE ts >= ? ORDER BY ts").all(since);
  // Aggregate per ts across ports, then diff consecutive timestamps.
  const byTs = new Map();
  for (const r of rows) {
    const e = byTs.get(r.ts) ?? { ts: r.ts, inB: 0, outB: 0 };
    e.inB += r.in_bytes ?? 0;
    e.outB += r.out_bytes ?? 0;
    byTs.set(r.ts, e);
  }
  const points = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].ts - points[i - 1].ts;
    out.push({
      ts: points[i].ts,
      // OUT bytes = download, IN = upload (matches the gauge + per-device convention).
      down_kbps: kbps(points[i].outB, points[i - 1].outB, dt),
      up_kbps: kbps(points[i].inB, points[i - 1].inB, dt),
    });
  }
  return out;
}

/** All-time / month / today consumption + per-device breakdown, from the ledger. */
export function getConsumption() {
  const today = dayKey(Date.now());
  const month = today.slice(0, 7); // 'YYYY-MM'
  const rows = db.prepare("SELECT day, scope, kind, down_bytes, up_bytes FROM usage_daily").all();

  const z = () => ({ down: 0, up: 0 });
  const add = (o, r) => { o.down += r.down_bytes; o.up += r.up_bytes; };
  const fin = (o) => ({ down_bytes: o.down, up_bytes: o.up, total_bytes: o.down + o.up });

  const win = { today: z(), month: z(), all: z() };
  const byScope = {};
  const unatt = z();

  for (const r of rows) {
    if (r.scope === "__unattributed__") { add(unatt, r); continue; }
    add(win.all, r);
    if (r.day === today) add(win.today, r);
    if (r.day.slice(0, 7) === month) add(win.month, r);
    const e = (byScope[r.scope] ??= { down: 0, up: 0, kind: r.kind });
    e.down += r.down_bytes; e.up += r.up_bytes;
  }

  // Map scopes (mac / 'DEV.ETH.IFx') to friendly device names + connection type.
  const nameForScope = {}, typeForScope = {};
  for (const d of db.prepare("SELECT mac, custom_name, hostname, conn_type, port FROM device").all()) {
    const name = d.custom_name || d.hostname || d.mac;
    if (d.conn_type === "wifi") { nameForScope[d.mac] = name; typeForScope[d.mac] = "wifi"; }
    else { const sc = lanToIf(d.port); if (sc) { nameForScope[sc] = name; typeForScope[sc] = "lan"; } }
  }
  const devices = Object.entries(byScope)
    .map(([scope, v]) => ({
      name: nameForScope[scope] || scope,
      conn_type: typeForScope[scope] || (v.kind === "wifi" ? "wifi" : "lan"),
      down_bytes: v.down, up_bytes: v.up, total_bytes: v.down + v.up,
    }))
    .filter((d) => d.total_bytes > 0)
    .sort((a, b) => b.total_bytes - a.total_bytes);

  const since_ts = db.prepare("SELECT MIN(ts) m FROM snapshot").get()?.m ?? null;

  // True total since the router booted, from its own cumulative counters.
  const b = db
    .prepare(
      `SELECT boot_down_bytes, boot_up_bytes, wired_down_bytes, wired_up_bytes,
              wifi_down_bytes, wifi_up_bytes, uptime_s
       FROM snapshot WHERE boot_down_bytes IS NOT NULL ORDER BY ts DESC LIMIT 1`,
    )
    .get();
  const since_boot = b
    ? {
        total_bytes: (b.boot_down_bytes ?? 0) + (b.boot_up_bytes ?? 0),
        down_bytes: b.boot_down_bytes ?? 0,
        up_bytes: b.boot_up_bytes ?? 0,
        wired_bytes: (b.wired_down_bytes ?? 0) + (b.wired_up_bytes ?? 0),
        wifi_bytes: (b.wifi_down_bytes ?? 0) + (b.wifi_up_bytes ?? 0),
        uptime_s: b.uptime_s ?? null,
      }
    : null;

  return {
    total_bytes: win.all.down + win.all.up,
    down_bytes: win.all.down,
    up_bytes: win.all.up,
    unattributed: fin(unatt),
    since_ts,
    since_boot,
    uptime_s: since_boot?.uptime_s ?? null,
    windows: { today: fin(win.today), month: fin(win.month), all: fin(win.all) },
    devices,
  };
}

function signalLabel(rssi) {
  if (rssi == null) return null;
  if (rssi >= -55) return "excellent";
  if (rssi >= -67) return "good";
  if (rssi >= -75) return "fair";
  return "weak";
}
