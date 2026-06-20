@echo off
REM Double-click this on Windows to run the MTN FibreX dashboard.
REM It builds the UI the first time, starts the app, and opens it in your browser.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js v22.9 or newer is required.
  echo Install it from https://nodejs.org  ^(choose the LTS button^), then run this again.
  pause
  exit /b 1
)

if not exist "web\out\index.html" (
  echo First run - building the dashboard ^(about a minute, only happens once^)...
  pushd web
  call npm install
  call npm run build:static
  popd
)

echo Starting your dashboard... keep this window open. Opening http://localhost:4000 ...
start "" http://localhost:4000
call npm start
pause
