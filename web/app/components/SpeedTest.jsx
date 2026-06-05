"use client";

import { useState } from "react";

// Real-time speed test (fast.com style). Streams download bytes and uses XHR
// upload progress to report live Mbps to the parent, which drives the gauge.
const DOWN_URL = (b) => `https://speed.cloudflare.com/__down?bytes=${b}`;
const UP_URL = "https://speed.cloudflare.com/__up";

export default function SpeedTest({ onUpdate }) {
  const [phase, setPhase] = useState("idle"); // idle | down | up | done | error

  const run = async () => {
    try {
      setPhase("ping");
      onUpdate?.({ phase: "ping" });
      const ping = await measurePing();

      setPhase("down");
      onUpdate?.({ phase: "down", mbps: 0, ping });
      const down = await measureDown((mbps) => onUpdate?.({ phase: "down", mbps, ping }));

      setPhase("up");
      onUpdate?.({ phase: "up", mbps: 0, downMbps: down, ping });
      const up = await measureUp((mbps) => onUpdate?.({ phase: "up", mbps, downMbps: down, ping }));

      setPhase("done");
      onUpdate?.({ phase: "done", downMbps: down, upMbps: up, ping });
      setTimeout(() => { setPhase("idle"); onUpdate?.(null); }, 6000);
    } catch {
      setPhase("error");
      onUpdate?.(null);
      setTimeout(() => setPhase("idle"), 3000);
    }
  };

  const running = phase === "ping" || phase === "down" || phase === "up";
  const label =
    phase === "ping" ? "Pinging…" :
    phase === "down" ? "Testing download…" :
    phase === "up" ? "Testing upload…" :
    phase === "done" ? "Done — test again" :
    phase === "error" ? "Retry test" : "Speed test";

  return (
    <button className="st-btn" onClick={run} disabled={running}>
      <Bolt />{label}
    </button>
  );
}

async function measurePing() {
  const times = [];
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    await fetch(DOWN_URL(0), { cache: "no-store" });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[1]; // 2nd-fastest, drops the best-case outlier
}

async function measureDown(onProgress) {
  const res = await fetch(DOWN_URL(60_000_000), { cache: "no-store" });
  const reader = res.body.getReader();
  const start = performance.now();
  let received = 0, last = start, lastBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    const now = performance.now();
    if (now - last > 180) {
      onProgress(((received - lastBytes) * 8) / ((now - last) / 1000) / 1e6);
      last = now; lastBytes = received;
    }
  }
  return (received * 8) / ((performance.now() - start) / 1000) / 1e6;
}

function measureUp(onProgress) {
  return new Promise((resolve, reject) => {
    const size = 20_000_000;
    const payload = new Uint8Array(size);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UP_URL);
    const start = performance.now();
    let last = start, lastLoaded = 0;
    xhr.upload.onprogress = (e) => {
      const now = performance.now();
      if (now - last > 180 && e.loaded > lastLoaded) {
        onProgress(((e.loaded - lastLoaded) * 8) / ((now - last) / 1000) / 1e6);
        last = now; lastLoaded = e.loaded;
      }
    };
    xhr.onload = () => resolve((size * 8) / ((performance.now() - start) / 1000) / 1e6);
    xhr.onerror = reject;
    xhr.send(payload);
  });
}

function Bolt() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ marginRight: 6 }}>
      <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" />
    </svg>
  );
}
