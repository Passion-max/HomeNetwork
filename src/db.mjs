// SQLite storage (Node built-in node:sqlite). Holds the history the router won't.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { accumulate, backfill } from "./ledger.mjs";

const DB_PATH = process.env.DB_PATH ?? "data/homenetwork.db";

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshot (
    ts            INTEGER PRIMARY KEY,        -- epoch ms
    cpu_pct       INTEGER, mem_pct INTEGER, flash_pct INTEGER,
    uptime_s      INTEGER,
    optical_temp_c REAL, optical_rx_dbm REAL, optical_tx_dbm REAL,
    wan_connected INTEGER, wan_ip TEXT, wan_online_s INTEGER,
    devices_online INTEGER,
    boot_down_bytes INTEGER, boot_up_bytes INTEGER,
    wired_down_bytes INTEGER, wired_up_bytes INTEGER,
    wifi_down_bytes INTEGER, wifi_up_bytes INTEGER
  );

  CREATE TABLE IF NOT EXISTS device (
    mac         TEXT PRIMARY KEY,
    hostname    TEXT,
    custom_name TEXT,                         -- user-assigned friendly name
    conn_type   TEXT,
    port        TEXT,
    first_seen  INTEGER,
    last_seen   INTEGER,
    blocked     INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS device_sample (
    ts        INTEGER,
    mac       TEXT,
    ip        TEXT, conn_type TEXT, ssid TEXT, band TEXT,
    rssi      INTEGER, snr INTEGER,
    rx_bytes  INTEGER, tx_bytes INTEGER,
    rx_rate   INTEGER, tx_rate INTEGER,
    link_time_s INTEGER,
    PRIMARY KEY (ts, mac)
  );
  CREATE INDEX IF NOT EXISTS idx_devsample_mac ON device_sample(mac, ts);

  CREATE TABLE IF NOT EXISTS port_sample (
    ts        INTEGER,
    port      TEXT,
    speed_mbps INTEGER,
    in_bytes  INTEGER, out_bytes INTEGER,
    PRIMARY KEY (ts, port)
  );

  -- Unified usage ledger (see ledger.mjs): authoritative Today/Month/All-time.
  CREATE TABLE IF NOT EXISTS usage_daily (
    day        TEXT NOT NULL,            -- 'YYYY-MM-DD' (local tz)
    scope      TEXT NOT NULL,            -- mac (wifi) | 'DEV.ETH.IFx' (port) | '__unattributed__'
    kind       TEXT,                     -- 'wifi' | 'port' | 'recon'
    down_bytes INTEGER NOT NULL DEFAULT 0,
    up_bytes   INTEGER NOT NULL DEFAULT 0,
    updated_ts INTEGER,
    PRIMARY KEY (day, scope)
  );

  -- Last cumulative counter seen per scope, for reset-aware delta computation.
  CREATE TABLE IF NOT EXISTS scope_state (
    scope     TEXT PRIMARY KEY,
    kind      TEXT,
    last_down INTEGER, last_up INTEGER, last_ts INTEGER
  );

  -- Small key/value store for one-time flags (e.g. backfill done).
  CREATE TABLE IF NOT EXISTS meta ( key TEXT PRIMARY KEY, value TEXT );
`);

// Migrations for pre-existing databases (each no-ops if the column already exists).
for (const stmt of [
  "ALTER TABLE device ADD COLUMN port TEXT",
  "ALTER TABLE snapshot ADD COLUMN boot_down_bytes INTEGER",
  "ALTER TABLE snapshot ADD COLUMN boot_up_bytes INTEGER",
  "ALTER TABLE snapshot ADD COLUMN wired_down_bytes INTEGER",
  "ALTER TABLE snapshot ADD COLUMN wired_up_bytes INTEGER",
  "ALTER TABLE snapshot ADD COLUMN wifi_down_bytes INTEGER",
  "ALTER TABLE snapshot ADD COLUMN wifi_up_bytes INTEGER",
]) {
  try {
    db.exec(stmt);
  } catch {
    /* already exists */
  }
}

const stmtSnapshot = db.prepare(`
  INSERT OR REPLACE INTO snapshot
    (ts,cpu_pct,mem_pct,flash_pct,uptime_s,optical_temp_c,optical_rx_dbm,optical_tx_dbm,
     wan_connected,wan_ip,wan_online_s,devices_online,
     boot_down_bytes,boot_up_bytes,wired_down_bytes,wired_up_bytes,wifi_down_bytes,wifi_up_bytes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?)
`);

const stmtUpsertDevice = db.prepare(`
  INSERT INTO device (mac,hostname,conn_type,port,first_seen,last_seen)
  VALUES (@mac,@hostname,@conn_type,@port,@ts,@ts)
  ON CONFLICT(mac) DO UPDATE SET
    hostname=COALESCE(excluded.hostname,hostname),
    conn_type=excluded.conn_type,
    port=COALESCE(excluded.port,port),
    last_seen=excluded.last_seen
`);

const stmtDeviceSample = db.prepare(`
  INSERT OR REPLACE INTO device_sample
    (ts,mac,ip,conn_type,ssid,band,rssi,snr,rx_bytes,tx_bytes,rx_rate,tx_rate,link_time_s)
  VALUES (@ts,@mac,@ip,@conn_type,@ssid,@band,@rssi,@snr,@rx_bytes,@tx_bytes,@rx_rate,@tx_rate,@link_time_s)
`);

const stmtPortSample = db.prepare(`
  INSERT OR REPLACE INTO port_sample (ts,port,speed_mbps,in_bytes,out_bytes)
  VALUES (@ts,@port,@speed_mbps,@in_bytes,@out_bytes)
`);

/** Persist one full poll cycle in a single transaction. */
export function saveSnapshot({ ts, system, wan, devices, ports, bootUsage = {} }) {
  try {
    db.exec("BEGIN");
    stmtSnapshot.run(
      ts,
      system.cpu_pct, system.mem_pct, system.flash_pct, system.uptime_s,
      system.optical_temp_c, system.optical_rx_dbm, system.optical_tx_dbm,
      wan.connected ? 1 : 0, wan.ip, wan.online_s,
      devices.length,
      bootUsage.down ?? null, bootUsage.up ?? null,
      bootUsage.wired_down ?? null, bootUsage.wired_up ?? null,
      bootUsage.wifi_down ?? null, bootUsage.wifi_up ?? null,
    );
    for (const d of devices) {
      if (!d.mac) continue;
      stmtUpsertDevice.run({
        mac: d.mac, hostname: d.hostname ?? null, conn_type: d.conn_type, port: d.port ?? null, ts,
      });
      stmtDeviceSample.run({
        ts, mac: d.mac, ip: d.ip ?? null, conn_type: d.conn_type, ssid: d.ssid ?? null,
        band: d.band ?? null, rssi: d.rssi ?? null, snr: d.snr ?? null,
        rx_bytes: d.rx_bytes ?? null, tx_bytes: d.tx_bytes ?? null,
        rx_rate: d.rx_rate ?? null, tx_rate: d.tx_rate ?? null, link_time_s: d.link_time_s ?? null,
      });
    }
    for (const p of ports) {
      stmtPortSample.run({
        ts, port: p.port, speed_mbps: p.speed_mbps ?? null,
        in_bytes: p.in_bytes ?? null, out_bytes: p.out_bytes ?? null,
      });
    }
    // Fold this cycle's cumulative counters into the unified usage ledger.
    accumulate(db, { ts, devices, ports });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const stmtRename = db.prepare("UPDATE device SET custom_name = ? WHERE mac = ?");
/** Set (or clear) a user-friendly name for a device. */
export function setDeviceName(mac, name) {
  stmtRename.run(name && name.trim() ? name.trim() : null, mac);
}

// One-time: rebuild the ledger from existing raw samples with the fixed
// bounded-delta logic (removes the historical inflation). No-op after first run.
try {
  if (backfill(db)) console.log("[ledger] backfilled usage_daily from history");
} catch (e) {
  console.error("[ledger] backfill failed:", e.message);
}

export { db };
