// Polls the router on an interval and stores snapshots for history.
import { RouterClient } from "./router/client.mjs";
import {
  TARGETS, normalizeSystem, normalizeWan, normalizePorts, normalizeDevices, normalizeBootUsage,
} from "./pages.mjs";
import { saveSnapshot } from "./db.mjs";

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 20000);
const client = new RouterClient();

/** Fetch every target page once and return normalized domain data. */
export async function pollOnce() {
  const sys = await client.fetchData(TARGETS.system.tags[0], TARGETS.system.menuId);
  const wanRaw = await client.fetchData(TARGETS.wan.tags[0], TARGETS.wan.menuId);

  // localnet bundles several tags under one menu view — navigate once, fetch all.
  await client.navigate(TARGETS.localnet.menuId);
  const portsRaw = await client.fetchData("status_lan_info_lua.lua");
  const wlanStatus = await client.fetchData("wlan_wlanstatus_lua.lua");
  const clients = await client.fetchData("wlan_client_stat_lua.lua");
  const lan = await client.fetchData("accessdev_landevs_lua.lua");

  const devices = normalizeDevices({ ...clients, ...lan });

  return {
    ts: Date.now(),
    system: normalizeSystem(sys),
    wan: normalizeWan(wanRaw),
    ports: normalizePorts(portsRaw),
    bootUsage: normalizeBootUsage(portsRaw, wlanStatus),
    devices,
  };
}

async function tick() {
  try {
    const data = await pollOnce();
    saveSnapshot(data);
    const sys = data.system;
    console.log(
      `[${new Date(data.ts).toLocaleTimeString()}] ` +
        `${data.devices.length} devices online | WAN ${data.wan.connected ? "up" : "down"} ${data.wan.ip ?? ""} | ` +
        `CPU ${sys.cpu_pct}% MEM ${sys.mem_pct}% | optical ${sys.optical_temp_c}°C`,
    );
  } catch (e) {
    console.error("poll error:", e.message);
    client.cookie = ""; // force re-login next cycle
  }
}

// Run as a daemon only when executed directly (not when imported).
const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry && import.meta.url === `file://${entry}`) {
  console.log(`Poller starting — every ${INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
  await tick();
  setInterval(tick, INTERVAL_MS);
}
