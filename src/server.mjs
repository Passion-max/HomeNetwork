// Backend: runs the poller loop and serves the read API (REST + SSE).
// Start with:  npm start
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { pollOnce } from "./poller.mjs";
import { saveSnapshot } from "./db.mjs";
import { store } from "./store/index.mjs";
import { startSync, syncEnabled } from "./sync/supabase.mjs";
import {
  authEnabled, authConfig, verifyPassword, issueSession, sessionFromReq, sessionCookie, clearCookie,
} from "./auth.mjs";

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
    const state = await store.getState();
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

const json = (res, body, status = 200, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

// Simple in-memory brute-force guard for the login endpoint (per client IP).
const loginFails = new Map(); // ip -> { n, ts }
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
function loginRateLimited(ip) {
  const e = loginFails.get(ip);
  if (!e || Date.now() - e.ts > FAIL_WINDOW_MS) return false;
  return e.n >= MAX_FAILS;
}
function noteLoginFail(ip) {
  const e = loginFails.get(ip);
  if (!e || Date.now() - e.ts > FAIL_WINDOW_MS) loginFails.set(ip, { n: 1, ts: Date.now() });
  else e.n += 1;
}

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

  if (req.method === "OPTIONS") {
    // Same-origin in prod (UI + API on one port) and in dev (Next proxies /api),
    // so no cross-origin CORS headers are issued.
    res.writeHead(204);
    return res.end();
  }

  const session = authEnabled() ? sessionFromReq(req) : { username: "open" };

  // Public auth endpoints + status (do not require a session).
  if (url.pathname === "/api/me") {
    return json(res, { auth_enabled: authEnabled(), authenticated: !!session, username: session?.username ?? null });
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    const ip = req.socket.remoteAddress ?? "?";
    if (loginRateLimited(ip)) return json(res, { error: "too many attempts — wait a few minutes" }, 429);
    let body = {};
    try { body = JSON.parse((await readBody(req)) || "{}"); } catch {}
    const c = authConfig();
    const ok = body.username === c.username && verifyPassword(body.password, c.passwordHash);
    if (!ok) {
      noteLoginFail(ip);
      return json(res, { error: "invalid username or password" }, 401);
    }
    loginFails.delete(ip);
    return json(res, { ok: true, username: c.username }, 200, { "Set-Cookie": sessionCookie(issueSession(c.username)) });
  }
  if (url.pathname === "/api/logout" && req.method === "POST") {
    return json(res, { ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  // Everything else under /api requires a valid session when auth is enabled.
  if (url.pathname.startsWith("/api/") && authEnabled() && !session) {
    return json(res, { error: "unauthorized" }, 401);
  }

  try {
    if (url.pathname === "/api/state") {
      const state = (await store.getState()) ?? {};
      state.collector = collectorHealth(state);
      state.auth_enabled = authEnabled();
      return json(res, state);
    }

    if (url.pathname === "/api/history") {
      const minutes = Number(url.searchParams.get("minutes") ?? 60);
      return json(res, await store.getHistory(minutes));
    }

    if (url.pathname === "/api/consumption") return json(res, await store.getConsumption());

    if (url.pathname === "/api/device-history") {
      const mac = url.searchParams.get("mac");
      const minutes = Number(url.searchParams.get("minutes") ?? 30);
      return json(res, mac ? await store.getDeviceHistory(mac, minutes) : []);
    }

    if (url.pathname === "/api/device/rename" && req.method === "POST") {
      const { mac, name } = JSON.parse((await readBody(req)) || "{}");
      if (mac) await store.setDeviceName(mac, name);
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
    });
    const s = await store.getState();
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
  if (authEnabled()) console.log("auth: ENABLED (single household login)");
  else console.warn("⚠ auth DISABLED — API is open (LAN only). Run `npm run set-password` and set the .env lines to enable login.");
  if (startSync()) console.log("cloud sync: ON (mirroring to Supabase)");
  else if (!syncEnabled()) console.log("cloud sync: off (set SUPABASE_URL/SERVICE_KEY/HOME_ID to enable)");
  tick();
  setInterval(tick, INTERVAL_MS);
});
