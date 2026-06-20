"use client";

import { useEffect, useRef, useState } from "react";
import Gauge from "./Gauge";
import Signal from "./Signal";
import Sparkline from "./Sparkline";
import BottomNav from "./BottomNav";
import DeviceDetail from "./DeviceDetail";
import SpeedTest from "./SpeedTest";
import Login from "./Login";
import { api, CLOUD } from "../lib/data";
import { dayKey } from "../lib/usage";

export default function Dashboard() {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [consumption, setConsumption] = useState(null);
  const [tab, setTab] = useState("home");
  const [selected, setSelected] = useState(null);
  const [rangeMin, setRangeMin] = useState(30);
  const [live, setLive] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // bump to re-pull after rename/login

  // Live state — same-origin polling (works on PC and phone alike).
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const data = await api.getState();
        if (!stop && data?.ts) { setAuthRequired(false); setState(data); setLive(true); }
        else if (!stop) setLive(false);
      } catch (e) {
        if (!stop) { if (e?.code === 401) { setAuthRequired(true); } setLive(false); }
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [refreshKey]);

  const logout = async () => {
    await api.logout().catch(() => {});
    setState(null);
    setLive(false);
    setAuthRequired(true);
  };

  useEffect(() => {
    const load = () =>
      api.getHistory(rangeMin)
        .then((d) => setHistory(Array.isArray(d) ? d : []))
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [rangeMin]);

  useEffect(() => {
    const load = () => api.getConsumption().then(setConsumption).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [refreshKey]);

  if (authRequired) {
    return <Login onSuccess={() => { setAuthRequired(false); setRefreshKey((k) => k + 1); }} />;
  }

  if (!state) {
    return <div className="loading"><div className="spin" /><span>linking to gateway…</span></div>;
  }

  // Freshness comes from the collector, not from "did the fetch succeed" — a
  // reachable server can still be serving a stale snapshot (router/VPN outage).
  // The local backend sends a `collector` block; the hosted mirror has none, so
  // derive freshness from the data's own timestamp (how stale the mirror is).
  const col = state.collector || (state.ts ? { age_s: Math.round((Date.now() - state.ts) / 1000), healthy: Date.now() - state.ts < 120000 } : {});
  const healthy = live && col.healthy;
  const staleLabel =
    col.age_s == null ? "offline"
    : col.age_s >= 3600 ? `stale · ${Math.round(col.age_s / 3600)}h`
    : `stale · ${Math.max(1, Math.round(col.age_s / 60))}m`;
  const chipLabel = !live ? "reconnecting" : col.healthy ? "live" : staleLabel;

  return (
    <>
      <main className="shell">
        <header className="topbar reveal">
          <div className="brand">
            <span className="wordmark">
              <span className="wm-mtn">MTN</span>
              <span className="wm-fibre">FIBRE</span>
              <span className="wm-x">X</span>
            </span>
            {state.network && (
              <span className="brand-net"><WifiGlyph />{state.network}</span>
            )}
          </div>
          <div className="topbar-right">
            <div className="livechip" title={col.last_error || ""}>
              <span className={`dot ${healthy ? "live" : "off"}`} />
              {chipLabel}
            </div>
            {(state.auth_enabled || CLOUD) && (
              <button className="logout-btn" onClick={logout} title="Sign out" aria-label="Sign out">⏻</button>
            )}
          </div>
        </header>

        {tab === "home" && (
          <HomeView
            state={state} consumption={consumption} history={history}
            rangeMin={rangeMin} setRangeMin={setRangeMin} setTab={setTab} onSelect={setSelected}
          />
        )}
        {tab === "devices" && <DevicesView state={state} onSelect={setSelected} />}
        {tab === "usage" && <UsageView consumption={consumption} state={state} />}
        {tab === "health" && <HealthView state={state} />}
      </main>

      <BottomNav tab={tab} setTab={setTab} />

      {selected && (
        <DeviceDetail
          device={selected}
          onClose={() => setSelected(null)}
          onRenamed={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </>
  );
}

/* ---------------- Home ---------------- */
const WIN_LABELS = { today: "Today", month: "Month", all: "All-time" };

function HomeView({ state, consumption, history, rangeMin, setRangeMin, setTab, onSelect }) {
  const { system, wan, totals, devices } = state;
  const [win, setWin] = useState("today");
  const [maskIp, setMaskIp] = useState(false);
  const [test, setTest] = useState(null); // live speed-test state
  const [lastResult, setLastResult] = useState(null); // persisted {down,up,ping}

  const onTest = (t) => {
    setTest(t);
    if (t?.phase === "done") setLastResult({ down: t.downMbps, up: t.upMbps, ping: t.ping });
  };

  const testingDown = test?.phase === "down";
  const testingUp = test?.phase === "up";
  const gaugeProps =
    test?.phase === "ping"
      ? { downKbps: 0, upKbps: 0, label: "pinging…" }
      : testingDown
        ? { overrideMbps: test.mbps, overrideKind: "down", label: "testing download", unit: "Mbps ↓" }
        : testingUp
          ? { overrideMbps: test.mbps, overrideKind: "up", label: "testing upload", unit: "Mbps ↑" }
          : test?.phase === "done"
            ? { overrideMbps: test.downMbps, overrideKind: "down", label: "speed test ✓", unit: "Mbps ↓" }
            : { downKbps: totals.down_kbps, upKbps: totals.up_kbps };
  const legDownKbps = test ? (testingDown ? test.mbps : test.downMbps ?? 0) * 1000 : totals.down_kbps;
  const legUpKbps = test ? (testingUp ? test.mbps : test.phase === "done" ? test.upMbps ?? 0 : 0) * 1000 : totals.up_kbps;
  const windows = consumption?.windows;
  const sel = windows?.[win];
  const animated = useCountUp(sel ? sel.total_bytes / 1073741824 : 0);

  return (
    <>
      {/* total-usage hero — tap to open the Usage page.
          NB: a <div role="button"> (not a real <button>) because it contains the
          window-toggle buttons, and a button cannot nest a button (hydration error). */}
      <div
        className="panel usage-hero reveal"
        role="button"
        tabIndex={0}
        onClick={() => setTab("usage")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab("usage"); } }}
      >
        <div className="uh-top">
          <span className="uh-label">Total usage</span>
          <div className="uh-toggle" onClick={(e) => e.stopPropagation()}>
            {Object.keys(WIN_LABELS).map((w) => (
              <button key={w} className={win === w ? "active" : ""} onClick={() => setWin(w)}>{WIN_LABELS[w]}</button>
            ))}
          </div>
        </div>
        <div className="uh-value mono">{sel ? animated.toFixed(2) : "—"} <span className="uh-unit">GB</span></div>
        {sel && (
          <div className="uh-split mono">
            <span className="down-c">↓ {fmtBytes(sel.down_bytes)}</span>
            <span className="up-c">↑ {fmtBytes(sel.up_bytes)}</span>
            <span className="uh-hint">details →</span>
          </div>
        )}
      </div>

      <section className="grid">
        <div className="panel hero reveal" style={{ animationDelay: "60ms" }}>
          <Gauge {...gaugeProps} />
          <div className="duplex">
            <Leg arrow="↓" cls="down-c" value={fmtSpeed(legDownKbps)} label={test ? "down" : "download"} />
            <Leg arrow="↑" cls="up-c" value={fmtSpeed(legUpKbps)} label={test ? "up" : "upload"} />
          </div>
          <SpeedTest onUpdate={onTest} />
        </div>

        <div className="panel statlist reveal" style={{ animationDelay: "120ms" }}>
          <Row k="Internet" v={wan.connected ? "Connected" : "Down"} accent={wan.connected} />
          <div className="statrow">
            <span className="k">Public IP</span>
            <span className="v mono ip-cell">
              {maskIp ? "•••.•••.•••.•••" : wan.ip ?? "—"}
              <button className="ip-toggle" onClick={() => setMaskIp((m) => !m)} aria-label={maskIp ? "Show IP" : "Hide IP"}>
                {maskIp ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </div>
          <Row k="Uptime" v={fmtDur(wan.online_s ?? system.uptime_s)} />
          <Row k="Devices online" v={`${totals.devices_online}`} />
          <Row k="Used today" v={<span className="mono"><span className="down-c">↓{fmtBytes(totals.used_today_down_bytes)}</span> <span className="up-c">↑{fmtBytes(totals.used_today_up_bytes)}</span></span>} />
          <Row
            k="Latency"
            v={
              (test?.ping ?? lastResult?.ping) != null
                ? <span className="mono">{Math.round(test?.ping ?? lastResult.ping)} ms{lastResult && !test ? <span className="ping-extra"> · ↓{lastResult.down.toFixed(0)} ↑{lastResult.up.toFixed(0)}</span> : ""}</span>
                : <span style={{ color: "var(--ink-faint)" }}>run speed test</span>
            }
          />
          <Row k="Optical / CPU" v={<span className="mono">{system.optical_temp_c ?? "—"}°C · {system.cpu_pct}%</span>} />
        </div>
      </section>

      <div className="sec-head reveal" style={{ animationDelay: "160ms" }}>
        <h2>Throughput</h2>
        <div className="range-toggle">
          {[[30, "30m"], [1440, "24h"], [10080, "7d"]].map(([m, lbl]) => (
            <button key={m} className={rangeMin === m ? "active" : ""} onClick={() => setRangeMin(m)}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="panel spark reveal" style={{ animationDelay: "180ms" }}>
        <div className="lbls"><span className="down-c">↓ download</span><span className="up-c">↑ upload</span></div>
        <Sparkline points={history} />
      </div>

      <div className="sec-head reveal"><h2>Connected devices</h2><span className="meta">{devices.length} online</span></div>
      <div className="panel devlist reveal">
        {devices.map((d) => (
          <button className="devrow" key={d.mac} onClick={() => onSelect(d)}>
            <span className={`pip ${d.conn_type}`} />
            <span className="dr-name">{d.name}</span>
            <span className="dr-type">{d.conn_type === "wifi" ? "Wi-Fi" : "LAN"}</span>
            <span className="dr-speed mono"><span className="down-c">↓{fmtSpeed(d.down_kbps)}</span> <span className="up-c">↑{fmtSpeed(d.up_kbps)}</span></span>
          </button>
        ))}
      </div>
    </>
  );
}

function WifiGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: 5 }}>
      <path d="M2 8.5a16 16 0 0 1 20 0" /><path d="M5 12a11 11 0 0 1 14 0" /><path d="M8.5 15.5a6 6 0 0 1 7 0" /><circle cx="12" cy="19" r="0.6" fill="currentColor" />
    </svg>
  );
}
const EYE_S = { width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
function Eye() {
  return <svg viewBox="0 0 24 24" {...EYE_S}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function EyeOff() {
  return <svg viewBox="0 0 24 24" {...EYE_S}><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.4 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3.6 4.4M6.2 6.2A16 16 0 0 0 2 12s3.5 7 10 7a10.5 10.5 0 0 0 3-.4" /></svg>;
}

/* ---------------- Devices ---------------- */
function DevicesView({ state, onSelect }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("traffic");

  const list = state.devices
    .filter((d) => filter === "all" || d.conn_type === filter)
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "usage"
          ? b.used_down_bytes + b.used_up_bytes - (a.used_down_bytes + a.used_up_bytes)
          : b.down_kbps + b.up_kbps - (a.down_kbps + a.up_kbps),
    );

  const counts = {
    all: state.devices.length,
    wifi: state.devices.filter((d) => d.conn_type === "wifi").length,
    lan: state.devices.filter((d) => d.conn_type === "lan").length,
  };

  return (
    <>
      <div className="sec-head"><h2>Devices</h2><span className="meta">{counts.all} on the network</span></div>

      <div className="filterbar reveal">
        <div className="chips">
          {[["all", "All"], ["wifi", "Wi-Fi"], ["lan", "Wired"]].map(([id, lbl]) => (
            <button key={id} className={`chip ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>
              {lbl} <span className="chip-n">{counts[id]}</span>
            </button>
          ))}
        </div>
        <select className="sortsel" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort devices">
          <option value="traffic">Live speed</option>
          <option value="usage">Data used</option>
          <option value="name">Name</option>
        </select>
      </div>

      {list.length === 0 && <div className="empty">no {filter === "all" ? "" : filter === "wifi" ? "Wi-Fi " : "wired "}devices</div>}
      <div className="devices">
        {list.map((d, i) => (
          <button className="panel dev reveal" key={d.mac} style={{ animationDelay: `${i * 45}ms` }} onClick={() => onSelect(d)}>
            <div className="head">
              <div>
                <div className="name">{d.name}</div>
                <div className="sub">{d.conn_type === "wifi" ? d.ssid : "Wired"} · <span className="ip">{d.ip ?? "—"}</span></div>
              </div>
              <span className={`badge ${d.conn_type}`}>{d.conn_type === "wifi" ? `Wi-Fi ${d.band ?? ""}` : "LAN"}</span>
            </div>
            <div className="head" style={{ alignItems: "center" }}>
              <div className="speeds">
                <div className="s"><b className="down-c mono">{fmtSpeed(d.down_kbps)}</b><small>↓ down</small></div>
                <div className="s"><b className="up-c mono">{fmtSpeed(d.up_kbps)}</b><small>↑ up</small></div>
              </div>
              {d.conn_type === "wifi" && <Signal rssi={d.rssi} quality={d.signal} />}
            </div>
            <div className="usedbar">
              <span className="lbl">used today</span>
              <span className="val mono"><span className="down-c">↓{fmtBytes(d.used_down_bytes)}</span> <span className="up-c">↑{fmtBytes(d.used_up_bytes)}</span></span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------------- Usage ---------------- */
const PERIODS = [["today", "Today"], ["yesterday", "Yesterday"], ["month", "This month"], ["all", "All-time"]];
const periodValue = (p) => {
  const now = Date.now();
  if (p === "today") return dayKey(now);
  if (p === "yesterday") return dayKey(now - 86400000);
  if (p === "month") return dayKey(now).slice(0, 7);
  return "all";
};
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayLabel = (d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const chipStyle = (on) => ({
  flex: "1 1 auto", padding: "8px 10px", borderRadius: 10, fontSize: 12.5, cursor: "pointer",
  border: "1px solid var(--panel-edge)", background: on ? "#ffcc00" : "rgba(255,255,255,0.04)",
  color: on ? "#1a1600" : "#968f7e", fontWeight: on ? 700 : 500,
});

function UsageView({ consumption }) {
  // `sel` is either a preset key (today/yesterday/month/all) or a 'YYYY-MM-DD' day.
  const [sel, setSel] = useState("today");
  const [bd, setBd] = useState(null);
  const [series, setSeries] = useState([]);
  const today = dayKey(Date.now());
  const apiPeriod = PERIODS.some((p) => p[0] === sel) ? periodValue(sel) : sel;

  useEffect(() => {
    let stop = false;
    setBd(null);
    api.getUsageFor(apiPeriod).then((d) => { if (!stop) setBd(d); }).catch(() => {});
    return () => { stop = true; };
  }, [apiPeriod]);

  useEffect(() => {
    let stop = false;
    api.getUsageSeries(30).then((d) => { if (!stop) setSeries(Array.isArray(d) ? d : []); }).catch(() => {});
    return () => { stop = true; };
  }, []);

  const boot = consumption?.since_boot;
  const total = bd?.total_bytes ?? 0;
  const devs = bd?.devices ?? [];
  const maxDay = Math.max(1, ...series.map((s) => s.total_bytes));
  const label = isDay(sel) ? dayLabel(sel) : PERIODS.find((p) => p[0] === sel)[1];

  return (
    <>
      <div className="panel consume open reveal" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {PERIODS.map(([k, lab]) => (
            <button key={k} onClick={() => setSel(k)} style={chipStyle(sel === k)}>{lab}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: "#968f7e" }}>Jump to a day:</span>
          <input type="date" max={today} value={isDay(sel) ? sel : ""}
            onChange={(e) => e.target.value && setSel(e.target.value)}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--panel-edge)", borderRadius: 10, color: "#f4f1e8", padding: "6px 10px", fontSize: 12.5, colorScheme: "dark" }} />
        </div>
        <div className="consume-head">
          <div className="consume-left">
            <span className="consume-label">{label} · all devices</span>
            <span className="consume-since">general usage</span>
          </div>
          <div className="consume-value mono">{(total / 1073741824).toFixed(2)} <span style={{ fontSize: "0.5em" }}>GB</span></div>
        </div>
        <div className="consume-detail">
          <div className="consume-split">
            <span className="down-c mono">↓ {fmtBytes(bd?.down_bytes ?? 0)} down</span>
            <span className="up-c mono">↑ {fmtBytes(bd?.up_bytes ?? 0)} up</span>
          </div>
          <div className="consume-subhead">By device · {label.toLowerCase()}</div>
          <div className="consume-devs">
            {bd && devs.length === 0 && <div className="cd-row"><span className="cd-name" style={{ color: "#5b564a" }}>No usage recorded for this period</span></div>}
            {devs.map((d) => (
              <div className="cd-row" key={d.name}>
                <span className="cd-name">{d.name}</span>
                <span className="cd-bar"><i style={{ width: `${Math.round((d.total_bytes / (total || 1)) * 100)}%` }} /></span>
                <span className="cd-val mono">{fmtBytes(d.total_bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel consume open reveal" style={{ marginBottom: 12 }}>
        <div className="consume-subhead" style={{ marginTop: 0 }}>Daily usage · tap a bar to view that day</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 100, padding: "6px 0" }}>
          {series.length === 0 && <span style={{ color: "#5b564a", fontSize: 12 }}>collecting daily history…</span>}
          {series.map((s) => {
            const on = s.day === sel;
            return (
              <button key={s.day} onClick={() => setSel(s.day)} title={`${dayLabel(s.day)}: ${fmtBytes(s.total_bytes)}`}
                style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                <div style={{ width: "72%", height: Math.max(3, Math.round((s.total_bytes / maxDay) * 84)), borderRadius: "3px 3px 0 0", background: on ? "#ffcc00" : (s.day === today ? "rgba(255,204,0,0.7)" : "rgba(255,204,0,0.32)") }} />
              </button>
            );
          })}
        </div>
        {series.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", color: "#5b564a", fontSize: 11, marginTop: 4 }}>
            <span>{series[0].day.slice(5)}</span>
            <span>{series[series.length - 1].day.slice(5)}</span>
          </div>
        )}
      </div>

      {boot && (
        <div className="panel consume open reveal">
          <div className="consume-head">
            <div className="consume-left">
              <span className="consume-label">Metered by router</span>
              <span className="consume-since">since boot · {fmtDur(boot.uptime_s)} uptime</span>
            </div>
            <div className="consume-value mono">{(boot.total_bytes / 1073741824).toFixed(2)} <span style={{ fontSize: "0.5em" }}>GB</span></div>
          </div>
        </div>
      )}
    </>
  );
}
function WinStat({ label, v }) {
  return <div className="winstat"><div className="ws-v mono">{v}</div><div className="ws-k">{label}</div></div>;
}

/* ---------------- Health ---------------- */
function HealthView({ state }) {
  const { system, wan } = state;
  const tempCls = system.optical_temp_c == null ? "" : system.optical_temp_c > 60 ? "weak-c" : "down-c";
  return (
    <>
      <div className="sec-head"><h2>Fiber & Device Health</h2></div>
      <div className="panel statlist">
        <Row k="Internet" v={wan.connected ? "Connected" : "Down"} accent={wan.connected} />
        <Row k="Public IP" v={<span className="mono">{wan.ip ?? "—"}</span>} />
        <Row k="WAN online" v={fmtDur(wan.online_s)} />
        <Row k="Router uptime" v={fmtDur(system.uptime_s)} />
        <Row k="Optical module temp" v={<span className={`mono ${tempCls}`}>{system.optical_temp_c ?? "—"} °C</span>} />
        <Row k="Optical Rx / Tx" v={<span className="mono">{system.optical_rx_dbm ?? "—"} / {system.optical_tx_dbm ?? "—"} dBm</span>} />
        <Row k="CPU usage" v={<span className="mono">{system.cpu_pct}%</span>} />
        <Row k="Memory usage" v={<span className="mono">{system.mem_pct}%</span>} />
        <Row k="Flash usage" v={<span className="mono">{system.flash_pct}%</span>} />
      </div>
    </>
  );
}

/* ---------------- bits ---------------- */
function Leg({ arrow, cls, value, label }) {
  return (
    <div className="leg">
      <span className={`arrow ${cls}`}>{arrow}</span>
      <div><div className={`num ${cls} mono`}>{value}</div><div className="lbl">{label}</div></div>
    </div>
  );
}
function Row({ k, v, accent }) {
  return <div className="statrow"><span className="k">{k}</span><span className={`v ${accent ? "accent" : ""}`}>{v}</span></div>;
}

function useCountUp(target, duration = 700) {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current, b = target;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(a + (b - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function fmtSpeed(kbps) {
  if (!kbps) return "0 kbps";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)} Mbps`;
  return `${kbps} kbps`;
}
function fmtBytes(b) {
  if (!b) return "0 MB";
  const mb = b / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
function fmtDur(s) {
  if (s == null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
