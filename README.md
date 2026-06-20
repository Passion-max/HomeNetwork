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

## Quick start (run it on a PC at home)
Install **Node ≥ 22.9** once (from [nodejs.org](https://nodejs.org), the LTS button),
then:

**Easiest — double-click:**
- **Mac:** double-click **`start.command`**
- **Windows:** double-click **`start.bat`**

It builds the dashboard the first time, starts it, and opens your browser to a
**setup page** — type your router password (it's on the sticker under the router)
and you're in. Keep that window open; the PC must be on the same WiFi as the router.

**Or from a terminal:**
```bash
cd web && npm install && npm run build:static && cd ..
npm start   # then open http://localhost:4000
```
> Prefer a config file? Create `.env` (see `.env.example`) with `ROUTER_HOST` /
> `ROUTER_USERNAME` / `ROUTER_PASSWORD` to skip the setup page. Dev with hot reload:
> `cd web && npm run dev` (:3010, proxies `/api` → :4000).

## View it from anywhere
Mirror to the cloud and open a private dashboard from any browser — the PC at home
stays the source of truth. See **[docs/HOSTING.md](docs/HOSTING.md)** (Supabase + Vercel).

## Optional: require a login
Auth is **off** until configured (the API is open on the LAN). To enable a single
household login:
```bash
npm run set-password -- 'your-password'   # prints AUTH_* + SESSION_SECRET lines
# paste them into .env, then restart `npm start`
```


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
