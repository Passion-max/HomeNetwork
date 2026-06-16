// Pure consumption aggregation over usage_daily rows — shared by the local
// (SQLite) and cloud (Supabase) stores so both report identical numbers.
// No DB or network imports, so a serverless reader can use it without pulling
// in node:sqlite.

/** "LAN3" -> "DEV.ETH.IF3" so a wired port's traffic maps to its device. */
export const lanToIf = (port) => {
  const n = /(\d+)/.exec(port ?? "")?.[1];
  return n ? `DEV.ETH.IF${n}` : null;
};

/**
 * Roll up usage_daily rows into Today/Month/All-time + per-device totals.
 * @param rows    [{ day, scope, kind, down_bytes, up_bytes }]
 * @param devices [{ mac, custom_name, hostname, conn_type, port }]
 * @param when    { today: 'YYYY-MM-DD', month: 'YYYY-MM' }
 */
export function aggregateConsumption(rows, devices, { today, month }) {
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

  const nameForScope = {}, typeForScope = {};
  for (const d of devices) {
    const name = d.custom_name || d.hostname || d.mac;
    if (d.conn_type === "wifi") { nameForScope[d.mac] = name; typeForScope[d.mac] = "wifi"; }
    else { const sc = lanToIf(d.port); if (sc) { nameForScope[sc] = name; typeForScope[sc] = "lan"; } }
  }

  const deviceList = Object.entries(byScope)
    .map(([scope, v]) => ({
      name: nameForScope[scope] || scope,
      conn_type: typeForScope[scope] || (v.kind === "wifi" ? "wifi" : "lan"),
      down_bytes: v.down, up_bytes: v.up, total_bytes: v.down + v.up,
    }))
    .filter((d) => d.total_bytes > 0)
    .sort((a, b) => b.total_bytes - a.total_bytes);

  return {
    total_bytes: win.all.down + win.all.up,
    down_bytes: win.all.down,
    up_bytes: win.all.up,
    unattributed: fin(unatt),
    windows: { today: fin(win.today), month: fin(win.month), all: fin(win.all) },
    devices: deviceList,
  };
}
