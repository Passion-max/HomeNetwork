# MTN FibreX — Home Network Dashboard

A premium, mobile-first dashboard & control panel for a home **MTN FibreX** fiber
line, built on top of the **ZTE F670L** router (which ships no usable app). Live
throughput, per-device usage & signal, total data consumption, a fast.com-style
speed test, and device management — MTN-branded, dark theme.

![tech](https://img.shields.io/badge/backend-Node%20(zero%20deps)-FFCC00)
![tech](https://img.shields.io/badge/frontend-Next.js%2016%20%C2%B7%20React%2019-111)

## Quick start
```bash
# backend config: create .env with ROUTER_HOST / ROUTER_USERNAME / ROUTER_PASSWORD
npm start                       # poller + API (+ UI) on :4000   (Node >= 22.5)
cd web && npm install && npm run dev   # frontend dev on :3010
```
You must be on the same LAN as the router (`192.168.1.1`).

## Docs
- **[CLAUDE.md](CLAUDE.md)** — architecture, run commands, gotchas, roadmap
- **[docs/HANDOFF.md](docs/HANDOFF.md)** — full background, decisions, history
- **[docs/MACOS.md](docs/MACOS.md)** — running on macOS
- **[DEPLOY.md](DEPLOY.md)** — always-on deployment (Android/Termux) + Tailscale

## Architecture
Dependency-free Node backend (poller + `node:sqlite` history + JSON API) → Next.js
PWA. In production one process serves UI + API + polling. See CLAUDE.md.
