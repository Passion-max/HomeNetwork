"use client";

import { useEffect, useState } from "react";
import Sparkline from "./Sparkline";
import Signal from "./Signal";
import { api } from "../lib/data";

export default function DeviceDetail({ device, onClose, onRenamed }) {
  const [history, setHistory] = useState([]);
  const [name, setName] = useState(device.name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getDeviceHistory(device.mac, 30)
      .then((d) => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [device.mac]);

  const save = async () => {
    setSaving(true);
    await api.renameDevice(device.mac, name);
    setSaving(false);
    onRenamed?.();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <div className="sheet-title">{device.name}</div>
            <div className="sheet-sub mono">{device.ip ?? "—"} · {device.mac}</div>
          </div>
          <span className={`badge ${device.conn_type}`}>
            {device.conn_type === "wifi" ? `Wi-Fi ${device.band ?? ""}` : "LAN"}
          </span>
        </div>

        <div className="sheet-stats">
          <Stat label="Download now" value={fmtSpeed(device.down_kbps)} cls="down-c" />
          <Stat label="Upload now" value={fmtSpeed(device.up_kbps)} cls="up-c" />
          <Stat label="Used today" value={fmtBytes(device.used_down_bytes + device.used_up_bytes)} />
          {device.conn_type === "wifi" && <Stat label="Signal" value={`${device.rssi} dBm`} />}
        </div>

        {device.conn_type === "wifi" && (
          <div className="sheet-signal">
            <Signal rssi={device.rssi} quality={device.signal} />
            <span className="ssid">{device.ssid}</span>
          </div>
        )}

        {(!api.cloud || history.length > 0) && (
          <>
            <div className="sheet-section">Throughput · last 30 min</div>
            <div className="panel" style={{ padding: "14px 14px 10px" }}>
              <Sparkline points={history} height={90} />
            </div>
          </>
        )}

        {api.canEdit && (
          <>
            <div className="sheet-section">Rename device</div>
            <div className="rename-row">
              <input
                className="rename-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={device.hostname || device.mac}
              />
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}

        <button className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Stat({ label, value, cls = "" }) {
  return (
    <div className="sheet-stat">
      <div className={`v mono ${cls}`}>{value}</div>
      <div className="k">{label}</div>
    </div>
  );
}
function fmtSpeed(kbps) {
  if (!kbps) return "0 kbps";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${kbps} kbps`;
}
function fmtBytes(b) {
  if (!b) return "0 MB";
  const mb = b / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
