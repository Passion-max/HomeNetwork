# Project Handoff & History

Full context for continuing this project on a new machine. (`CLAUDE.md` has the
quick reference; this is the story behind it.)

## Goal
The user installed **MTN FibreX** (fiber). The router (**ZTE F670L GPON ONT**,
firmware V9.0.11P5N17) has only a clunky stock web UI — no app, no usage view, no
nice management. We're building a **premium, Starlink-style dashboard** to monitor
and manage the network, MTN-branded (yellow `#FFCC00` on near-black).

## How we talk to the router (reverse-engineered)
The F670L has **no API** and no SSH/telnet/SNMP. Everything goes through its web UI:
- **Login:** GET `login_token` → `Password = sha256(plainPassword + token)` → POST
  `login_entry`. Keep the **last** `SID=` cookie. (Account is the limited `user`.)
- **Data:** must GET `?_type=menuView&_tag=<menuId>` to "navigate" first, then
  `?_type=menuData&_tag=<x>.lua` returns **XML** with `OBJ_*` / `ID_*` objects of
  `<Instance>` rows. Parsed generically in `src/router/client.mjs`.
- Key pages: `statusMgr` (device/optical), `ethWanStatus` (WAN/public IP),
  `localNetStatus` (ports, SSIDs, WiFi clients incl. RSSI/SNR/bytes, wired clients).

## Decisions made with the user
- **Mobile-first PWA**, Next.js + React, dark MTN theme, FibreX wordmark.
- Backend kept **dependency-free** (Node built-ins) so it runs anywhere.
- **Single-process** production mode: backend serves the static-exported UI + API.
- **Always-on collector** must stay on the home LAN (router only reachable locally).
  Plan landed on: dev on the laptop now → run collector on the **M5 MacBook** (stays
  home) or an **old Android phone (Termux)** → eventually a **dedicated mini-PC**
  (Intel N100 recommended). User has **24/7 solar power**.
- **Remote access:** Tailscale (free, already in use).
- User is also exploring **Home Assistant** (separate system) in **VirtualBox** on the
  Mac to learn; will get an always-on box later. (HA is NOT part of this repo.)

## What's built (all working)
- Auth + generic XML parser; resilient client (auto re-login).
- Poller → SQLite history (`data/homenetwork.db`); per-cycle snapshots.
- JSON API (`/api/state`, `/api/history`, `/api/consumption`, `/api/device-history`,
  `/api/device/rename`). (SSE existed but we use same-origin polling — simpler,
  firewall-proof, works on phone.)
- PWA: tabs **Home / Devices / Usage / Health**; concentric-ring gauge; live
  throughput chart (log-scaled); per-device cards with signal bars; device detail
  sheet (history + **rename**, persisted); **total usage** card with Today/Month/
  All-time; network name; IP **mask toggle** (for screenshots); **fast.com-style
  speed test** (download/upload climb on the gauge live + **ping/latency** row);
  device **filter (All/Wi-Fi/Wired) + sort**; count-up animations; brand watermark.

## Bugs fixed & lessons (important)
- **Throughput chart blank** — turned out to be a *field-name mismatch* (`p.down`
  vs `p.down_kbps`) → NaN/baseline. Also: linear scale buried traffic (switched to
  **log scale**), and **`var()` in SVG stroke attrs doesn't render** (use hex).
- **Usage inflation (the big one)** — the "Total usage" card diffed the router's
  *combined* counter; an occasional poll missing a port made the sum dip then
  "recover", adding **phantom GBs** (showed 33 GB vs real ~23 GB, down/up swapped).
  Fixed by using the **per-device/per-port method everywhere** (`sumUsageSince`).
  Verified the two "today" figures now match exactly.
- **Wired devices showed 0 speed** — they have no per-device byte counters; now
  derived from their LAN port. Also their **names were invisible** because device
  cards became `<button>` (inherited dark button text) — fixed the color.
- **Phone stuck "linking"** — Next 16 blocked cross-origin dev resources; fixed with
  `allowedDevOrigins`. Earlier also moved off SSE to same-origin polling.
- **Router counters wrap** (and reset); all aggregation is **reset-aware**.

## A real investigation worth remembering
User saw "31 GB used today" with the house empty. We proved (from raw samples, zero
impossible 15s jumps) it was **real, steady traffic** from two of their own phones:
one streaming/downloading ~19 GB, another doing cloud-backup uploads ~7 GB. Lesson:
unattended **streaming + cloud backup + OS updates** quietly burn tens of GB. This is
the motivation for the planned **heavy-usage alerts**.

## Next steps / open items
1. Run the collector persistently (Mac or phone) — see `DEPLOY.md` / `docs/MACOS.md`.
2. **Heavy-usage alerts** (notify when a device passes N GB/day).
3. **Phase 2 device control** (block/unblock) — verify `user`-account write perms.
4. Longer term: **shareable multi-user hosted version** (auth + multi-tenant).
5. Optional: surface FibreX data inside Home Assistant once that box exists.
