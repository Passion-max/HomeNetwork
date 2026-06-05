# Running on the Mac (continuing development)

## 1. Install Node ≥ 22.5 (Apple Silicon native)
The backend uses the built-in `node:sqlite`, which needs Node 22.5+.
```bash
# Option A — Homebrew
brew install node            # check: node --version  (>= 22.5)

# Option B — download the macOS arm64 installer from nodejs.org
```

## 2. Clone and configure
```bash
git clone <your-repo-url> homenetwork && cd homenetwork

# Create .env in the repo root (NOT committed):
cat > .env <<'EOF'
ROUTER_HOST=192.168.1.1
ROUTER_USERNAME=user
ROUTER_PASSWORD=user
EOF
```
> You must be on the **home WiFi** (same LAN as the router 192.168.1.1) for the
> poller to reach it.

## 3. Run
```bash
# quick sanity check — logs into the router and dumps device info:
npm run probe

# backend (poller + API) on :4000  (serves the UI too if web/out exists):
npm start

# frontend dev with hot reload on :3010 (proxies /api -> :4000):
cd web && npm install && npm run dev
```
Open http://localhost:3010 (dev) or http://localhost:4000 (single-process).

## 4. Phone access on the Mac's network
The dev server's allowed origins are hard-coded to the old Windows box's LAN IP.
Find the Mac's IP (`ipconfig getifaddr en0`) and update `web/next.config.mjs`:
```js
allowedDevOrigins: ["<mac-lan-ip>", "localhost"],
```
Then open `http://<mac-lan-ip>:3010` on the phone. (Single-process `:4000` mode
needs no such change — it serves everything same-origin.)

## 5. Keep it collecting (Mac as the always-on box, for now)
The Mac stays home, so it can be the collector. Prevent sleep while it runs:
```bash
# run the backend and keep the Mac awake for as long as it runs:
caffeinate -s npm start
```
For lid-closed/clamshell or auto-start on login, use a `launchd` agent later. The
SQLite DB at `data/homenetwork.db` persists across restarts; collection just pauses
whenever the Mac sleeps or leaves the home network, and resumes after.

## Note on Home Assistant (separate project)
Home Assistant is its own system, **not** part of this repo. To learn it on the Mac,
run **HAOS in VirtualBox** (import the HA VirtualBox image, set the network adapter
to *Bridged* so it gets a LAN IP, browse to `http://<vm-ip>:8123`). Add the Tailscale
add-on inside HA for remote access. A dedicated mini-PC is the eventual home for it.
