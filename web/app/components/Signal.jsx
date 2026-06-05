"use client";

// Five-bar signal strength derived from RSSI, colored by quality.
const LEVELS = { excellent: 5, good: 4, fair: 3, weak: 2 };

export default function Signal({ rssi, quality }) {
  if (rssi == null) return null;
  const filled = LEVELS[quality] ?? 1;
  return (
    <div className="signal-meta">
      <div className="signal" title={`${rssi} dBm`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <i
            key={i}
            className={i <= filled ? `on ${quality}` : ""}
            style={{ height: `${5 + i * 2.6}px` }}
          />
        ))}
      </div>
      <span className={`q ${quality}`}>{quality}</span>
    </div>
  );
}
