# MTN FibreX — Home Network Dashboard

A premium, Starlink-style dashboard + control panel for a home **MTN FibreX** fiber
connection whose router (**ZTE F670L GPON ONT**) ships no usable management UI. It
polls the router, stores history, and shows live throughput, per-device usage,
signal, and total data consumption. MTN-branded (yellow on near-black).

> **Continuity note:** This file + the docs below carry the project context across
> machines (Claude's own memory is machine-local and does NOT travel with the repo).
> Read `docs/HANDOFF.md` for the full background, decisions, and history.

## Architecture
- **Backend** (`src/`) — a **dependency-free** Node service (only Node built-ins:
  `http`, `node:sqlite`, `crypto`). It logs into the F670L, polls every ~15s,
  stores snapshots in SQLite, and serves a JSON API. It can also serve the built
  frontend, so in production it's **one process** doing UI + API + polling.
- **Frontend** (`web/`) — **Next.js 16 + React 19** PWA. MTN dark theme, tabs:
  Home / Devices / Usage / Health. Talks to the backend via same-origin `/api/*`.
- **Data flow:** router → `src/poller.mjs` → `src/db.mjs` (SQLite at
  `data/homenetwork.db`) → `src/queries.mjs` → `src/server.mjs` API → frontend.

## Running it (macOS)
Needs **Node ≥ 22.5** (for built-in `node:sqlite`). Apple Silicon native.

```bash
# 1. Backend config — create .env (NOT committed) in the repo root:
#    ROUTER_HOST=192.168.1.1
#    ROUTER_USERNAME=user
#    ROUTER_PASSWORD=<the router 'user' password>

# 2. Backend (poller + API), serves UI too if web/out exists:
npm start            # -> http://localhost:4000   (node --experimental-sqlite)

# 3. Frontend dev (hot reload), proxies /api to :4000:
cd web && npm install && npm run dev   # -> http://localhost:3010

# Production single-process (what a dedicated box / phone runs):
cd web && npm run build:static         # builds web/out
cd .. && npm start                     # serves UI + API on :4000
```
Useful scripts: `npm run probe` (test router login), `node src/discover.mjs <menuId>`
(dump a router page's data tags). See `DEPLOY.md` for always-on deployment
(Android/Termux) and `docs/MACOS.md` for Mac specifics.

> When changing the LAN IP for phone access in dev, update `allowedDevOrigins` in
> `web/next.config.mjs` (currently set to this Mac's `192.168.1.2`). A change here
> needs a **dev-server restart** to take effect.

## Key files
- `src/router/client.mjs` — F670L login handshake + XML parsing (see comments).
- `src/pages.mjs` — maps raw router objects to clean records.
- `src/queries.mjs` — all read/aggregation logic (usage, history, devices).
- `web/app/components/Dashboard.jsx` — main UI (tabs, gauge, speed test, etc.).

## Critical gotchas (don't reintroduce)
- **Usage totals MUST use the per-device/per-port method** (`usageSince` /
  `sumUsageSince`): WiFi clients' RX=download/TX=upload; wired = each LAN port
  (out=download, in=upload); reset-aware. **Never diff the router's *combined*
  boot counters** — a poll occasionally drops a port, the sum dips then "recovers",
  inflating totals with phantom GBs (we saw 33 GB shown vs 23 GB real, down/up
  swapped). The WiFi *radio* TotalBytesSent/Received direction is ambiguous; avoid.
- Wired devices report **no per-device byte counters** — derive their speed/usage
  from their LAN port (`LAN3` → `DEV.ETH.IF3`).
- F670L data pages need a **`menuView` "navigate" request before `menuData`**, else
  `SessionTimeout`. Capture the **last** `SID=` cookie after login.
- **You MUST `GET /` once right after login** (`client.mjs` does this). The login
  response returns `login_need_refresh: true`, meaning the session is only
  *half-activated*; the real browser reloads root, and that GET finalizes it
  server-side. Skip it and login still "succeeds" (you get a SID cookie) but every
  `menuView` returns **404** → every `menuData` returns **`SessionTimeout`** → the
  poller stores all-null snapshots forever. This bit us after firmware
  V9.0.11P5N17: symptoms look like a changed API, but the tags/objects are
  unchanged — only the missing GET / was at fault. (June 2026.)
- Router allows **one `user` session at a time**: a new login bumps the previous
  one. So the poller and a browser logged into the router UI fight each other
  (the UI logs out within seconds). Stop the poller while inspecting the router by
  hand.
- **CSS `var()` does NOT work in SVG presentation attributes** — use literal hex.
- **Next 16** blocks cross-origin dev resources → set `allowedDevOrigins` for phone
  access in dev.
- npm registry behind a TLS-intercepting network → install with `--strict-ssl=false`
  (one-off, don't persist).

## Roadmap / not yet done
- **Phase 2 device control** (block/unblock a device) — needs router *write* access;
  verify the limited `user` account's permissions first.
- **Heavy-usage alerts** (e.g. notify when a device passes N GB/day).
- **Shareable multi-user online version** (needs auth + multi-tenant) — future goal.
- Optical Rx/Tx power is admin-only on the `user` login (shows "—").

## Conventions
- **Never add `Co-Authored-By` trailers** to commits (breaks deploy attribution).
- Keep the backend **dependency-free** (Node built-ins only) so it runs anywhere
  (phone/Termux, mini-PC) with no install.
