# Deploying the collector to an always-on Android phone (Termux) + Tailscale

The backend is a **single dependency-free Node process** that serves the dashboard
UI, the API, and runs the poller. The phone just needs Node + the project files
(the frontend is pre-built into `web/out/` on the laptop — no build on the phone).

## A. Build the static UI on the laptop (once per UI change)

```powershell
cd web
npm run build:static      # creates web/out/  (~1 MB)
```

## B. Get the files onto the phone

The phone needs only these (small — no `node_modules`):
- `src/`
- `web/out/`
- `package.json`
- `.env`  (create it on the phone — never commit your password)

Transfer by zipping and sending via cloud/USB, or via git (note: `web/out/` and
`.env` are git-ignored, so copy those two manually after cloning).

## C. Set up Termux on the phone

1. Install **Termux from F-Droid** (NOT the Play Store version — it's outdated).
2. In Termux:
   ```bash
   pkg update && pkg upgrade -y
   pkg install nodejs-lts   # or: pkg install nodejs   (need Node >= 22.5)
   node --version           # confirm >= 22.5 for built-in node:sqlite
   termux-wake-lock         # stop Android sleeping the process
   ```
3. Put the project somewhere, e.g. `~/homenetwork`, with your `.env` filled in.
4. Run it:
   ```bash
   cd ~/homenetwork
   node --experimental-sqlite --env-file=.env src/server.mjs
   ```
   You should see: `Dashboard + API on http://localhost:4000 (serving web/out)`.
5. On the home WiFi, open `http://<phone-LAN-ip>:4000` from any device.

> Keep the phone on home WiFi (so it can reach the router at 192.168.1.1) and on
> the charger. Disable battery optimization for Termux: Android Settings → Apps →
> Termux → Battery → Unrestricted.

### Auto-start on phone reboot (optional)
Install **Termux:Boot** (F-Droid). Create `~/.termux/boot/start.sh`:
```bash
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/homenetwork
node --experimental-sqlite --env-file=.env src/server.mjs
```
`chmod +x ~/.termux/boot/start.sh`

### If `node:sqlite` is unavailable on the phone's Node
Fallback: `pkg install clang make python && npm install better-sqlite3` and switch
`src/db.mjs` to better-sqlite3 (ask Claude to do this swap).

## D. Remote access with Tailscale (view from work)

1. Install **Tailscale** on the phone (Play Store) and on your laptop/viewing phone.
2. Sign all devices into the **same Tailscale account**.
3. The collector phone gets a stable Tailscale address (e.g. `100.x.y.z` or a
   MagicDNS name like `oldphone`).
4. From anywhere, open `http://<that-tailscale-name>:4000`.

No port-forwarding, no exposing the router to the internet — Tailscale tunnels it
securely. The phone still reaches the router over local WiFi as usual; Tailscale
only carries your inbound dashboard view.

## Notes
- The database lives at `data/homenetwork.db` on the phone and persists across
  reboots. Back it up by copying that file.
- Data is collected whenever the phone is on home WiFi and the process is running.
- On the laptop you can also just run `npm start` and use `http://localhost:4000`
  (same single-process mode), or `npm run dev` (port 3010) for development.
