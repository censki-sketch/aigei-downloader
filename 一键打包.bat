@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Aigei Downloader - Release Build
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

if not exist "node_modules\electron-builder\out\cli\cli.js" (
  echo [SETUP] Installing project dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed. Check the network and npm settings.
    pause
    exit /b 1
  )
)

echo [BUILD] Creating the installer and portable ZIP...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\package-release.ps1"
set "BUILD_EXIT_CODE=%ERRORLEVEL%"

if not "%BUILD_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Release build failed with exit code %BUILD_EXIT_CODE%.
  echo Keep this window open and review the error above.
  pause
  exit /b %BUILD_EXIT_CODE%
)

echo.
echo [DONE] Release files are available in dist-build.
start "" explorer.exe "%CD%\dist-build"
pause
exit /b 0
