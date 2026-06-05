"use client";

// Concentric throughput rings — outer = download (yellow), inner = upload (blue).
// When `overrideMbps` is set (during a speed test) the gauge shows that single
// value fast.com-style, filling only the active ring.
export default function Gauge({
  downKbps = 0, upKbps = 0, capMbps = 120,
  overrideMbps = null, overrideKind = null, label = "live throughput", unit = "Mbps total",
}) {
  const frac = (kbps) => Math.min(1, Math.log10(1 + kbps / 1000) / Math.log10(1 + capMbps));
  const testing = overrideMbps != null;
  const big = testing ? overrideMbps : (downKbps + upKbps) / 1000;
  const downFrac = testing ? (overrideKind === "down" ? frac(overrideMbps * 1000) : 0) : frac(downKbps);
  const upFrac = testing ? (overrideKind === "up" ? frac(overrideMbps * 1000) : 0) : frac(upKbps);

  return (
    <div className="gauge-wrap">
      <svg viewBox="0 0 248 248" width="248" height="248">
        <defs>
          <linearGradient id="gDown" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffe27a" />
            <stop offset="1" stopColor="#ffcc00" />
          </linearGradient>
          <linearGradient id="gUp" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7cc4ff" />
            <stop offset="1" stopColor="#4fb0ff" />
          </linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="2.5" /></filter>
        </defs>

        <g transform="rotate(135 124 124)">
          <Ring r={106} frac={downFrac} stroke="url(#gDown)" />
          <Ring r={82} frac={upFrac} stroke="url(#gUp)" />
        </g>
      </svg>

      <div className="gauge-readout">
        <div className="big mono">{fmtMbps(big)}</div>
        <div className="unit">{unit}</div>
        <div className={`ctx ${testing ? "testing" : ""}`}>{label}</div>
      </div>
    </div>
  );
}

function Ring({ r, frac, stroke }) {
  const C = 2 * Math.PI * r;
  const sweep = 0.75; // 270°
  return (
    <>
      <circle
        cx="124" cy="124" r={r} fill="none" stroke="rgba(255,255,255,0.055)"
        strokeWidth="11" strokeLinecap="round" strokeDasharray={`${C * sweep} ${C}`}
      />
      <circle
        cx="124" cy="124" r={r} fill="none" stroke={stroke} strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${C * sweep * frac} ${C}`}
        filter="url(#glow)"
        style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.16,1,0.3,1)" }}
      />
    </>
  );
}

function fmtMbps(m) {
  if (m >= 100) return Math.round(m).toString();
  if (m >= 10) return m.toFixed(1);
  return m.toFixed(2);
}
