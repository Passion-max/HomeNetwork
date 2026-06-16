// Backend: runs the poller loop and serves the read API (REST + SSE).
// Start with:  npm start
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { pollOnce } from "./poller.mjs";
import { saveSnapshot } from "./db.mjs";
import { getState, getThroughputHistory, getConsumption, getDeviceHistory } from "./queries.mjs";
import { setDeviceName } from "./db.mjs";

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const PORT = Number(process.env.API_PORT ?? 4000);
const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15000);

const sseClients = new Set();

// Collector health — surfaced on /api/state so the UI can tell live from stale
// (a router/VPN outage used to freeze the dashboard silently behind a "LIVE" badge).
const health = { last_ok_ts: null, last_error: null, consecutive_failures: 0 };

async function tick() {
  try {
    const data = await pollOnce();
    saveSnapshot(data);
    health.last_ok_ts = Date.now();
    health.last_error = null;
    health.consecutive_failures = 0;
    const state = getState();
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of sseClients) res.write(payload);
    process.stdout.write(
      `\r[${new Date().toLocaleTimeString()}] ${state.totals.devices_online} online · ` +
        `↓${(state.totals.down_kbps / 1000).toFixed(1)} ↑${(state.totals.up_kbps / 1000).toFixed(1)} Mbps   `,
    );
  } catch (e) {
    health.consecutive_failures += 1;
    health.last_error = e.message;
    console.error(`\npoll error (#${health.consecutive_failures}):`, e.message);
  }
}

/** Collector health block merged into /api/state, derived from data freshness. */
function collectorHealth(state) {
  const now = Date.now();
  const age_s = state?.ts ? Math.round((now - state.ts) / 1000) : null;
  const healthy = age_s != null && age_s < (INTERVAL_MS * 3) / 1000;
  return {
    healthy,
    age_s,
    last_ok_ts: health.last_ok_ts,
    consecutive_failures: health.consecutive_failures,
    last_error: health.last_error,
  };
}

const json = (res, body, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
};

// Static frontend (the exported Next site). Present only in single-process /
// production mode; in dev the Next server handles the UI instead.
const WEB_DIR = join(process.cwd(), "web", "out");
const SERVE_WEB = existsSync(WEB_DIR);
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain",
};

async function serveStatic(res, pathname) {
  // Resolve within WEB_DIR; map "/" and unknown routes to index.html (SPA).
  let rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  let file = join(WEB_DIR, rel || "index.html");
  if (!extname(file)) file = join(WEB_DIR, "index.html");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(WEB_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS preflight (rename POST from the browser)
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    if (url.pathname === "/api/state") {
      const state = getState() ?? {};
      state.collector = collectorHealth(state);
      return json(res, state);
    }

    if (url.pathname === "/api/history") {
      const minutes = Number(url.searchParams.get("minutes") ?? 60);
      return json(res, getThroughputHistory(minutes));
    }

    if (url.pathname === "/api/consumption") return json(res, getConsumption());

    if (url.pathname === "/api/device-history") {
      const mac = url.searchParams.get("mac");
      const minutes = Number(url.searchParams.get("minutes") ?? 30);
      return json(res, mac ? getDeviceHistory(mac, minutes) : []);
    }

    if (url.pathname === "/api/device/rename" && req.method === "POST") {
      const { mac, name } = JSON.parse((await readBody(req)) || "{}");
      if (mac) setDeviceName(mac, name);
      return json(res, { ok: !!mac });
    }
  } catch (e) {
    console.error("\nAPI error:", e.message);
    return json(res, { error: e.message }, 500);
  }

  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const s = getState();
    if (s) res.write(`data: ${JSON.stringify(s)}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // Anything else: serve the static frontend (single-process mode) or 404.
  if (SERVE_WEB && !url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
  json(res, { error: "not found" }, 404);
});

server.listen(PORT, () => {
  console.log(
    `${SERVE_WEB ? "Dashboard + API" : "API"} on http://localhost:${PORT}` +
      `${SERVE_WEB ? " (serving web/out)" : ""}  ·  polling every ${INTERVAL_MS / 1000}s`,
  );
  tick();
  setInterval(tick, INTERVAL_MS);
});
