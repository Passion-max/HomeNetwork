# MTN FibreX — Home Network Dashboard

A premium, mobile-first dashboard & control panel for a home **MTN FibreX** fiber
line, built on top of the **ZTE F670L** GPON router (which ships no usable app).
Live throughput, per-device usage & signal, total data consumption (Today / Month /
All-time), a fast.com-style speed test, router health — MTN-branded, dark theme.

![backend](https://img.shields.io/badge/backend-Node%20(zero%20deps)-FFCC00)
![frontend](https://img.shields.io/badge/frontend-Next.js%2016%20%C2%B7%20React%2019-111)

## Features
- **Live throughput** gauge + history chart, per-device down/up speeds.
- **Accurate usage** — a reset-aware ledger (Today / Month / All-time, per device)
  that doesn't inflate on router counter resets.
- **Devices** — names, connection type, signal, per-device data used.
- **Health** — WAN status, uptime, optical module, CPU/memory.
- **Login** — optional single-household auth (dependency-free).
- **Run anywhere** — local LAN, an always-on box, or a public hosted site.

## Quick start (local, on your LAN)
Requires **Node ≥ 22.9**. No config files to edit — a setup page asks for your
router password on first run.
```bash
# build the UI once, then start the single process (UI + API + poller) on :4000
cd web && npm install && npm run build:static && cd ..
npm start
```
Now open **http://localhost:4000** — you'll get a **setup page**: enter your router
password (it's on the sticker under the router) and you're done. You must be on the
same WiFi as the router.

> Prefer config files? You can still create a `.env` (see `.env.example`) with
> `ROUTER_HOST` / `ROUTER_USERNAME` / `ROUTER_PASSWORD` and skip the setup page.
> Dev with hot reload: `cd web && npm run dev` on :3010 (proxies `/api` → :4000).

## Optional: require a login
Auth is **off** until configured (the API is open on the LAN). To enable a single
household login:
```bash
npm run set-password -- 'your-password'   # prints AUTH_* + SESSION_SECRET lines
# paste them into .env, then restart `npm start`
```

## Run it from anywhere (hosted)
Mirror to Supabase and deploy the read-only dashboard to Vercel — the home collector
stays primary and keeps working offline. See **[docs/HOSTING.md](docs/HOSTING.md)**.

## Architecture
```
ZTE F670L ─▶ poller ─▶ SQLite (node:sqlite) ─▶ JSON API ─▶ Next.js PWA
                          └▶ (optional) Supabase mirror ─▶ hosted dashboard
```
- **Backend** (`src/`) — dependency-free Node (built-ins only): logs into the F670L,
  polls every ~15s, stores history in SQLite, serves a JSON API, and can serve the
  built UI (one process). A `store` seam selects local SQLite or the cloud mirror.
- **Frontend** (`web/`) — Next.js 16 + React 19 PWA. One codebase: talks to the local
  `/api/*` or, in the hosted build, reads Supabase directly with Row-Level Security.

## Deploy options
- **[docs/HOSTING.md](docs/HOSTING.md)** — Supabase mirror + Vercel hosted site.
- **[DEPLOY.md](DEPLOY.md)** — always-on collector on Android/Termux + Tailscale.

## Security notes
- The local API is **open on the LAN** until you enable the login above.
- Secrets live only in `.env` (git-ignored). Never commit the router password or the
  Supabase `service_role` key; the hosted browser uses only the public `anon` key,
  protected by Row-Level Security.

## License
MIT — see [LICENSE](LICENSE).
