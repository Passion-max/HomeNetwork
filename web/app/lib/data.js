// One data layer, two backends. The home single-process build talks to the local
// /api/* server; the hosted (Vercel) build reads Supabase directly with the user's
// session (RLS keeps each home private). Selected at build time by whether
// NEXT_PUBLIC_SUPABASE_URL is present. Components import only from here.
import { CLOUD, supabase } from "./supabaseClient";
import { aggregateConsumption, dayKey } from "./usage";

const unauth = () => Object.assign(new Error("unauthorized"), { code: 401 });

// ---- Local backend (same-origin /api/*) ------------------------------------
const local = {
  cloud: false,
  canEdit: true,
  async getState() {
    const r = await fetch("/api/state");
    if (r.status === 401) throw unauth();
    return r.json();
  },
  getConsumption: () => fetch("/api/consumption").then((r) => (r.ok ? r.json() : null)),
  getHistory: (min) => fetch(`/api/history?minutes=${min}`).then((r) => (r.ok ? r.json() : [])),
  getDeviceHistory: (mac, min) =>
    fetch(`/api/device-history?mac=${encodeURIComponent(mac)}&minutes=${min}`).then((r) => (r.ok ? r.json() : [])),
  getUsageFor: (period) => fetch(`/api/usage?period=${encodeURIComponent(period)}`).then((r) => (r.ok ? r.json() : null)),
  getUsageSeries: (days) => fetch(`/api/usage/series?days=${days}`).then((r) => (r.ok ? r.json() : [])),
  renameDevice: (mac, name) =>
    fetch("/api/device/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac, name }),
    }),
  async login(username, password) {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, status: r.status, error: j.error || "Invalid credentials" };
  },
  logout: () => fetch("/api/logout", { method: "POST" }),
};

// ---- Cloud backend (Supabase, browser-direct + RLS) ------------------------
const cloud = {
  cloud: true,
  canEdit: false, // a hosted rename would be overwritten by the home sync; read-only for now
  async getState() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw unauth();
    const { data, error } = await supabase.from("home_state").select("state_json").limit(1).maybeSingle();
    if (error) throw error;
    return data?.state_json ?? {};
  },
  async getConsumption() {
    const today = dayKey(Date.now());
    const [{ data: rows }, { data: devs }] = await Promise.all([
      supabase.from("usage_daily").select("day,scope,kind,down_bytes,up_bytes"),
      supabase.from("device").select("mac,custom_name,hostname,conn_type,port"),
    ]);
    const agg = aggregateConsumption(rows || [], devs || [], { today, month: today.slice(0, 7) });
    return { ...agg, since_ts: null, since_boot: null, uptime_s: null };
  },
  async getHistory(min) {
    const since = Date.now() - min * 60000;
    const { data } = await supabase.from("throughput").select("ts,down_kbps,up_kbps").gte("ts", since).order("ts");
    return data || [];
  },
  getDeviceHistory: async () => [], // per-device samples aren't mirrored
  async getUsageFor(period) {
    let q = supabase.from("usage_daily").select("day,scope,kind,down_bytes,up_bytes");
    if (period !== "all") q = /^\d{4}-\d{2}$/.test(period) ? q.like("day", period + "%") : q.eq("day", period);
    const [{ data: rows }, { data: devs }] = await Promise.all([
      q,
      supabase.from("device").select("mac,custom_name,hostname,conn_type,port"),
    ]);
    const agg = aggregateConsumption(rows || [], devs || [], { today: period, month: period });
    return { period, total_bytes: agg.total_bytes, down_bytes: agg.down_bytes, up_bytes: agg.up_bytes, unattributed: agg.unattributed, devices: agg.devices };
  },
  async getUsageSeries(days = 14) {
    const start = dayKey(Date.now() - (days - 1) * 86400000);
    const { data: rows } = await supabase.from("usage_daily").select("day,down_bytes,up_bytes").neq("scope", "__unattributed__").gte("day", start);
    const byDay = {};
    for (const r of rows || []) { const e = (byDay[r.day] ??= { d: 0, u: 0 }); e.d += r.down_bytes; e.u += r.up_bytes; }
    return Object.entries(byDay).map(([day, v]) => ({ day, down_bytes: v.d, up_bytes: v.u, total_bytes: v.d + v.u })).sort((a, b) => (a.day < b.day ? -1 : 1));
  },
  renameDevice: async () => {}, // disabled in cloud mode
  async login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false, status: 401, error: error.message } : { ok: true };
  },
  logout: () => supabase.auth.signOut(),
};

export const api = CLOUD ? cloud : local;
export { CLOUD };
