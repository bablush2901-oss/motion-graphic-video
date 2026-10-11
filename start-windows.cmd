@echo off
setlocal
cd /d "%~dp0"
title Motion Studio Local

echo Motion Studio Local
echo Keep this window open while using the app.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or newer from https://nodejs.org/
  echo Then close this window and run start-windows.cmd again.
  goto :failure
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo This app needs Node.js 22 or newer. Please update Node.js.
  goto :failure
)

if not exist "node_modules\" (
  echo Installing app dependencies. This may take a few minutes...
  if exist "package-lock.json" (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 goto :failure
)

echo Checking the rendering browser...
call npm run setup
if errorlevel 1 goto :failure

if not exist "dist\index.html" (
  echo Building the app...
  call npm run build
  if errorlevel 1 goto :failure
)

set "APP_PORT=3001"
for /f "delims=" %%P in ('node -e "require('dotenv').config({quiet:true}); const p=Number(process.env.PORT || 3001); console.log(Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : 3001)"') do set "APP_PORT=%%P"
echo.
echo Starting http://localhost:%APP_PORT%
echo If Ollama is unavailable, open Ollama or use template mode.
echo To stop the app, press Ctrl+C in this window.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%APP_PORT%'"
call npm start
if errorlevel 1 goto :failure
exit /b 0

:failure
echo.
echo The app could not start. Read the message above or the README troubleshooting table.
pause
exit /b 1
