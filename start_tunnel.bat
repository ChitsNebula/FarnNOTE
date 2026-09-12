@chcp 65001 >nul
@echo off
title FarmNotes Web - Local Server & Cloudflare Tunnel
cd /d "%~dp0"
echo ========================================================
echo [FarmNotes Web] Checking & pulling latest version from GitHub...
echo ========================================================
git pull origin main
echo.
echo ========================================================
echo [FarmNotes Web] Starting Local Server (Port 8080)...
echo ========================================================
start "FarmNotes Server" python server.py
timeout /t 2 >nul

echo ========================================================
echo [FarmNotes Web] Launching Cloudflare Tunnel...
echo ========================================================
cloudflared tunnel --url http://127.0.0.1:8080
pause
