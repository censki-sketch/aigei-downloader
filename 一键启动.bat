@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 爱给下载器 - 开发模式

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20 或更高版本。
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron-vite\bin\electron-vite.js" (
  echo [准备] 首次运行，正在安装项目依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络或 npm 配置。
    pause
    exit /b 1
  )
)

echo [启动] 正在启动爱给下载器...
call npm run dev
if errorlevel 1 (
  echo.
  echo [错误] 启动失败，请保留此窗口中的错误信息。
  pause
)

