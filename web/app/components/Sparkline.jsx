"use client";

// Dual-area throughput chart (download mint + upload ice-blue).
// Uses a percentile-based scale so a single spike doesn't flatten everyday
// traffic into an invisible line at the bottom.
export default function Sparkline({ points = [], height = 120 }) {
  const W = 600;
  const H = height;

  // Keep only points with finite numeric values so a stray null can never
  // produce a NaN in the SVG path (which silently blanks the whole chart).
  const data = (points ?? []).filter(
    (p) => Number.isFinite(p?.down_kbps) && Number.isFinite(p?.up_kbps),
  );

  if (data.length < 2) {
    return (
      <div style={{ height: H, display: "grid", placeItems: "center", color: "var(--ink-faint)", fontSize: 12 }}>
        collecting data…
      </div>
    );
  }

  const all = data.flatMap((p) => [p.down_kbps, p.up_kbps]).sort((a, b) => a - b);
  const peak = all[all.length - 1];

  // Logarithmic scale: home traffic spans a huge dynamic range (idle kbps to
  // multi-Mbps spikes), so a linear axis buries everyday traffic on the baseline.
  const max = Math.max(150, peak);
  const lg = (v) => Math.log10(1 + Math.max(0, v));
  const lgMax = lg(max) || 1; // never divide by zero

  const x = (i) => (i / (data.length - 1)) * W;
  const y = (v) => {
    const yy = H - (lg(v) / lgMax) * (H - 10) - 4;
    return Number.isFinite(yy) ? yy : H - 4;
  };

  const line = (key) => data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const area = (key) => `${line(key)} L${W},${H} L0,${H} Z`;

  const now = data[data.length - 1];

  return (
    <div className="spark-body">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id="aDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(255,204,0,0.55)" />
            <stop offset="1" stopColor="rgba(255,204,0,0)" />
          </linearGradient>
          <linearGradient id="aUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(79,176,255,0.42)" />
            <stop offset="1" stopColor="rgba(79,176,255,0)" />
          </linearGradient>
        </defs>
        {/* faint baseline */}
        <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <path d={area("up_kbps")} fill="url(#aUp)" />
        <path d={line("up_kbps")} fill="none" stroke="#4fb0ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={area("down_kbps")} fill="url(#aDown)" />
        <path d={line("down_kbps")} fill="none" stroke="#ffcc00" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="spark-stats mono">
        <span><b className="down-c">{fmt(now.down_kbps)}</b> / <b className="up-c">{fmt(now.up_kbps)}</b> now</span>
        <span className="peak">peak {fmt(peak)}</span>
      </div>
    </div>
  );
}

function fmt(kbps) {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}
