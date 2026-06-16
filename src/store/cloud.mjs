// Cloud read store — serves a hosted dashboard from the Supabase mirror.
// Selected with STORE=cloud. Reads via PostgREST using the service key
// (server-side). Same shape as the local store, but intentionally imports NO
// SQLite, so it runs in a serverless/edge environment without node:sqlite.
//
// Single-home for now (HOME_ID from env). A multi-tenant hosted reader would
// resolve home_id from the authenticated user instead.
import { aggregateConsumption } from "../usage.mjs";
import { dayKey } from "../ledger.mjs";

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const HOME_ID = process.env.HOME_ID;
const TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS ?? 15000);

const get = (q) =>
  fetch(`${BASE}/rest/v1/${q}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`supabase ${q} ${r.status}`);
    return r.json();
  });

async function getState() {
  const rows = await get(`home_state?home_id=eq.${HOME_ID}&select=state_json&limit=1`);
  return rows[0]?.state_json ?? null;
}

async function getConsumption() {
  const [rows, devices] = await Promise.all([
    get(`usage_daily?home_id=eq.${HOME_ID}&select=day,scope,kind,down_bytes,up_bytes`),
    get(`device?home_id=eq.${HOME_ID}&select=mac,custom_name,hostname,conn_type,port`),
  ]);
  const today = dayKey(Date.now());
  const agg = aggregateConsumption(rows, devices, { today, month: today.slice(0, 7) });
  return { ...agg, since_ts: null, since_boot: null, uptime_s: null };
}

async function getHistory(minutes = 60) {
  const since = Date.now() - minutes * 60_000;
  return get(`throughput?home_id=eq.${HOME_ID}&ts=gte.${since}&select=ts,down_kbps,up_kbps&order=ts`);
}

// Per-device time series isn't mirrored (high-frequency samples stay local).
async function getDeviceHistory() {
  return [];
}

async function setDeviceName(mac, name) {
  await fetch(`${BASE}/rest/v1/device?on_conflict=home_id,mac`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ home_id: HOME_ID, mac, custom_name: name && name.trim() ? name.trim() : null }]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export const cloudStore = { name: "cloud", getState, getConsumption, getHistory, getDeviceHistory, setDeviceName };
