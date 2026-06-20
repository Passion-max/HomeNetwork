#!/bin/bash
# Double-click this on a Mac to run the MTN FibreX dashboard.
# It builds the UI the first time, starts the app, and opens it in your browser.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js (v22.9 or newer) is required."
  echo "Install it from https://nodejs.org  (choose the LTS button), then double-click this again."
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -f web/out/index.html ]; then
  echo "First run — building the dashboard (about a minute, only happens once)…"
  ( cd web && npm install && npm run build:static ) || { echo "Build failed."; read -r -p "Press Enter to close…"; exit 1; }
fi

# Already running? Just open it.
if curl -s -o /dev/null --max-time 2 http://localhost:4000; then
  echo "Dashboard is already running — opening it."
  open http://localhost:4000
  exit 0
fi

echo "Starting your dashboard… keep this window open. Opening http://localhost:4000 …"
( sleep 3; open http://localhost:4000 ) &
npm start
