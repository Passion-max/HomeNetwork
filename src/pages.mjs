// Maps the router's raw OBJ_* data into clean domain records for storage.
// Each target = a menu section + the data tags to pull from it.

export const TARGETS = {
  system: { menuId: "statusMgr", tags: ["devmgr_statusmgr_lua.lua"] },
  wan: { menuId: "ethWanStatus", tags: ["wan_internetstatus_lua.lua&TypeUplink=2&pageType=1"] },
  localnet: {
    menuId: "localNetStatus",
    tags: [
      "status_lan_info_lua.lua", // ethernet port traffic
      "wlan_wlanstatus_lua.lua", // SSIDs
      "wlan_client_stat_lua.lua", // wifi clients (+ RSSI/SNR/bytes)
      "accessdev_landevs_lua.lua", // wired clients
    ],
  },
};

const num = (v) => (v == null || v === "" ? null : Number(v));

// --- normalizers: raw parsed XML object -> domain records ---------------------

export function normalizeSystem(p) {
  const dev = p.OBJ_DEVINFO_ID?.[0] ?? {};
  const cpu = p.OBJ_CPUMEMUSAGE_ID?.[0] ?? {};
  const cores = Object.keys(cpu)
    .filter((k) => k.startsWith("CpuUsage"))
    .map((k) => num(cpu[k]));
  return {
    model: dev.ModelName ?? null,
    serial: dev.SerialNumber ?? null,
    software: dev.SoftwareVer ?? null,
    boot: dev.BootVer ?? null,
    uptime_s: num(p.OBJ_POWERONTIME_ID?.[0]?.PowerOnTime),
    cpu_pct: cores.length ? Math.round(cores.reduce((a, b) => a + b, 0) / cores.length) : null,
    mem_pct: num(cpu.MemUsage),
    flash_pct: num(p.OBJ_FLASHINFO_ID?.[0]?.Flash_Percent_Used),
    optical_temp_c: num(p.OBJ_PON_OPTICALPARA_ID?.[0]?.Temp),
    optical_rx_dbm: num(p.OBJ_PON_OPTICALPARA_ID?.[0]?.RxPower),
    optical_tx_dbm: num(p.OBJ_PON_OPTICALPARA_ID?.[0]?.TxPower),
  };
}

export function normalizeWan(p) {
  const w = p.ID_WAN_COMFIG?.[0] ?? {};
  return {
    name: w.WANCName ?? null,
    ip: w.IPAddress || null,
    connected: w.ConnStatus === "Connected",
    status: w.ConnStatus ?? null,
    type: w.TransType ?? w.wantype ?? null,
    nat: w.IsNAT === "1",
    mac: w.WorkIFMac ?? null,
    online_s: num(w.UpTime),
  };
}

export function normalizePorts(p) {
  return (p.OBJ_PON_PORT_BASIC_STATUS_ID ?? []).map((r) => ({
    port: r._InstID,
    speed_mbps: num(r.Speed),
    duplex: r.Duplex ?? null,
    in_bytes: num(r.InBytes),
    out_bytes: num(r.OutBytes),
  }));
}

export function normalizeSsids(p) {
  return (p.OBJ_WLANAP_ID ?? [])
    .filter((r) => r.ESSID && !/^SSID\d$/.test(r.ESSID)) // hide unused default SSIDs
    .map((r) => ({
      id: r._InstID,
      alias: r.Alias,
      name: r.ESSID,
      enabled: r.Enable === "1",
      encryption: r["11iEncryptType"] ?? null,
    }));
}

/**
 * Total network usage SINCE ROUTER BOOT, from the router's own cumulative
 * counters. Wired = ethernet ports; WiFi = radio totals. The two paths are
 * disjoint (a client is on one or the other), so summing gives the true total.
 * Direction is device-centric: download = bytes the router sent to the device.
 */
export function normalizeBootUsage(portsParsed, wlanStatusParsed) {
  let wiredDown = 0,
    wiredUp = 0;
  for (const r of portsParsed.OBJ_PON_PORT_BASIC_STATUS_ID ?? []) {
    wiredDown += Number(r.OutBytes || 0);
    wiredUp += Number(r.InBytes || 0);
  }
  let wifiDown = 0,
    wifiUp = 0;
  for (const r of wlanStatusParsed.OBJ_WLANCONFIGDRV_ID ?? []) {
    wifiDown += Number(r.TotalBytesSent || 0);
    wifiUp += Number(r.TotalBytesReceived || 0);
  }
  return {
    wired_down: wiredDown,
    wired_up: wiredUp,
    wifi_down: wifiDown,
    wifi_up: wifiUp,
    down: wiredDown + wifiDown,
    up: wiredUp + wifiUp,
  };
}

/** Unified device list from wifi clients + wired clients. */
export function normalizeDevices(clientPage, lanIsInClientPage = true) {
  const devices = [];

  // SSID id -> human name lookup (present in the wifi client page too)
  const ssidName = {};
  for (const ap of clientPage.OBJ_WLANAP_ID ?? []) ssidName[ap._InstID] = ap.ESSID;

  for (const w of clientPage.OBJ_WLAN_AD_ID ?? []) {
    devices.push({
      mac: w.MACAddress,
      hostname: w.HostName || null,
      ip: w.IPAddress || null,
      ipv6: w.IPV6Address || null,
      conn_type: "wifi",
      ssid: ssidName[w.AliasName] || w.AliasName || null,
      band: w.BAND || null,
      mode: w.CurrentMode || null,
      rssi: num(w.RSSI),
      snr: num(w.SNR),
      noise: num(w.NOISE),
      rx_bytes: num(w.RXBytes),
      tx_bytes: num(w.TXBytes),
      rx_rate: num(w.RxRate),
      tx_rate: num(w.TxRate),
      link_time_s: num(w.LinkTime),
      connect_time: w.ConnectTime || null,
    });
  }

  for (const l of clientPage.OBJ_ACCESSDEV_ID ?? []) {
    devices.push({
      mac: l.MACAddress,
      hostname: l.HostName || null,
      ip: l.IPAddress || null,
      ipv6: l.IPV6Address || null,
      conn_type: "lan",
      ssid: null,
      port: l.AliasName || null,
    });
  }

  return devices;
}
