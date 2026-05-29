@echo off
title Stream Alert Hub v1.0
color 0A
chcp 65001 >nul

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   Stream Alert Hub v1.0                             ║
echo  ║   1 Browser Source untuk semua notifikasi donasi    ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo  [ERROR] Node.js tidak ditemukan!
  echo  Download: https://nodejs.org
  pause & exit /b 1
)

if not exist "node_modules\" (
  echo  [*] Install dependencies pertama kali...
  npm install
  echo.
)

echo  [OK] Menjalankan server...
echo.
echo  Dashboard  : http://localhost:3000
echo  Overlay OBS: http://localhost:3000/overlay
echo.
echo  INGAT: Jalankan juga ngrok di terminal lain:
echo         ngrok http 3000
echo.
echo  Tekan Ctrl+C untuk stop.
echo.

node server.js
pause
