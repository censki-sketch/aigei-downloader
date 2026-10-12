@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Aigei Downloader - Development
set "NPM_CONFIG_CACHE=%LOCALAPPDATA%\AigeiDownloader\npm-cache"
if not exist "%NPM_CONFIG_CACHE%" mkdir "%NPM_CONFIG_CACHE%" >nul 2>nul

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 20 or newer from https://nodejs.org/
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found.
  echo Reinstall Node.js and enable the npm option.
  pause
  exit /b 1
)

if not exist "node_modules\electron-vite\bin\electron-vite.js" (
  echo [SETUP] Installing project dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed. Check the network and npm settings.
    pause
    exit /b 1
  )
)

echo [START] Starting Aigei Downloader...
node --require ./crypto-polyfill.js node_modules/electron-vite/bin/electron-vite.js dev
set "APP_EXIT_CODE=%ERRORLEVEL%"

if not "%APP_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Startup failed with exit code %APP_EXIT_CODE%.
  echo Keep this window open and review the error above.
  pause
)

exit /b %APP_EXIT_CODE%
