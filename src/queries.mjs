// Read helpers over the SQLite history. Computes live speeds from sample deltas.
import { db } from "./db.mjs";

const twoLatestTs = () =>
  db.prepare("SELECT ts FROM snapshot ORDER BY ts DESC LIMIT 2").all().map((r) => r.ts);

/** Rate in kbps between two cumulative byte readings. */
const kbps = (cur, prev, dtMs) =>
  cur == null || prev == null || !dtMs || cur < prev ? 0 : Math.round(((cur - prev) * 8) / (dtMs / 1000) / 1000);

/** Positive byte delta between two cumulative readings; treats a drop as a counter reset. */
const bdelta = (cur, prev) => (cur == null || prev == null ? 0 : cur >= prev ? cur - prev : Math.max(0, cur));

const startOfTodayMs = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "LAN3" -> "DEV.ETH.IF3" so we can attribute a wired port's traffic to its device. */
const lanToIf = (port) => {
  const n = /(\d+)/.exec(port ?? "")?.[1];
  return n ? `DEV.ETH.IF${n}` : null;
};

/** Cumulative usage since `since`, summing reset-aware deltas. */
function usageSince(since) {
  // WiFi: per-MAC from device byte counters.
  const wifi = {};
  let prev = {};
  for (const r of db.prepare("SELECT mac,rx_bytes,tx_bytes FROM device_sample WHERE ts>=? ORDER BY mac,ts").all(since)) {
    const p = prev[r.mac];
    (wifi[r.mac] ??= { down: 0, up: 0 });
    if (p) {
      wifi[r.mac].down += bdelta(r.rx_bytes, p.rx);
      wifi[r.mac].up += bdelta(r.tx_bytes, p.tx);
    }
    prev[r.mac] = { rx: r.rx_bytes, tx: r.tx_bytes };
  }
  // Wired: per-port. From the device's view, port InBytes = its upload, OutBytes = its download.
  const ports = {};
  prev = {};
  for (const r of db.prepare("SELECT port,in_bytes,out_bytes FROM port_sample WHERE ts>=? ORDER BY port,ts").all(since)) {
    const p = prev[r.port];
    (ports[r.port] ??= { down: 0, up: 0 });
    if (p) {
      ports[r.port].down += bdelta(r.out_bytes, p.out);
      ports[r.port].up += bdelta(r.in_bytes, p.in);
    }
    prev[r.port] = { in: r.in_bytes, out: r.out_bytes };
  }
  return { wifi, ports };
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

  const usage = usageSince(startOfTodayMs());

  // Port samples (for wired-device live speed + total throughput).
  const curPorts = db.prepare("SELECT * FROM port_sample WHERE ts = ?").all(ts2);
  const curPortMap = new Map(curPorts.map((r) => [r.port, r]));
  const prevPorts = new Map(
    (ts1 ? db.prepare("SELECT * FROM port_sample WHERE ts = ?").all(ts1) : []).map((r) => [r.port, r]),
  );

  const devices = cur.map((s) => {
    const p = prev.get(s.mac);
    const u = s.conn_type === "wifi" ? usage.wifi[s.mac] : usage.ports[lanToIf(s.dev_port)];

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

  // Total throughput from active port deltas.
  let totalDown = 0,
    totalUp = 0;
  for (const port of curPorts) {
    const pp = prevPorts.get(port.port);
    totalDown += kbps(port.in_bytes, pp?.in_bytes, dtMs);
    totalUp += kbps(port.out_bytes, pp?.out_bytes, dtMs);
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

/**
 * Total network usage since `sinceMs`, using the robust per-device / per-port
 * method (the same one used for live speed and "used today"). WiFi clients use
 * their own RX/TX counters (unambiguous: RX = download), wired uses each LAN
 * port (out = download, in = upload). Reset-aware. We deliberately do NOT diff
 * the router's *combined* counters — a single poll missing a port makes that
 * sum dip then "recover", inflating totals with phantom GBs.
 */
function sumUsageSince(sinceMs) {
  const u = usageSince(sinceMs);
  let down = 0, up = 0;
  for (const v of Object.values(u.wifi)) { down += v.down; up += v.up; }
  for (const v of Object.values(u.ports)) { down += v.down; up += v.up; }
  return { down_bytes: down, up_bytes: up, total_bytes: down + up };
}

/** Usage over windows (today / month / all-time since tracking began). */
export function getUsageWindows() {
  const sot = new Date(); sot.setHours(0, 0, 0, 0);
  const som = new Date(); som.setDate(1); som.setHours(0, 0, 0, 0);
  return {
    today: sumUsageSince(sot.getTime()),
    month: sumUsageSince(som.getTime()),
    all: sumUsageSince(0),
  };
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
      down_kbps: kbps(points[i].inB, points[i - 1].inB, dt),
      up_kbps: kbps(points[i].outB, points[i - 1].outB, dt),
    });
  }
  return out;
}

/** All-time cumulative consumption since tracking began, with per-device breakdown. */
export function getConsumption() {
  const u = usageSince(0);
  const devs = db.prepare("SELECT mac,custom_name,hostname,conn_type,port FROM device").all();

  let down = 0,
    up = 0;
  const perDevice = [];
  for (const d of devs) {
    const usg = d.conn_type === "wifi" ? u.wifi[d.mac] : u.ports[lanToIf(d.port)];
    if (!usg || usg.down + usg.up === 0) continue;
    down += usg.down;
    up += usg.up;
    perDevice.push({
      name: d.custom_name || d.hostname || d.mac,
      conn_type: d.conn_type,
      down_bytes: usg.down,
      up_bytes: usg.up,
      total_bytes: usg.down + usg.up,
    });
  }
  perDevice.sort((a, b) => b.total_bytes - a.total_bytes);

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
    total_bytes: down + up, down_bytes: down, up_bytes: up,
    since_ts, since_boot, windows: getUsageWindows(), devices: perDevice,
  };
}

function signalLabel(rssi) {
  if (rssi == null) return null;
  if (rssi >= -55) return "excellent";
  if (rssi >= -67) return "good";
  if (rssi >= -75) return "fair";
  return "weak";
}
