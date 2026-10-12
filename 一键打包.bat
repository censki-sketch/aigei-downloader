@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 爱给下载器 - 发行版打包

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)

if not exist "node_modules\electron-builder\out\cli\cli.js" (
  echo [准备] 正在安装项目依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

call npm run release:win
if errorlevel 1 (
  echo.
  echo [错误] 打包失败，请查看上方错误信息。
  pause
  exit /b 1
)

echo.
echo [完成] 安装版和免安装版已生成到 dist-build 目录。
explorer "%CD%\dist-build"
pause

