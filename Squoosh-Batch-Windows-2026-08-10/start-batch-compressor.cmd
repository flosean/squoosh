@echo off
cd /d "%~dp0"
if not exist "build\index.html" (
  echo Build not found. Run npm install and npm run build first.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run this local app.
  pause
  exit /b 1
)
start "" "http://localhost:5000"
node local-server.js
pause
