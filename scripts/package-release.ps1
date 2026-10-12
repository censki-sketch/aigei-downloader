param(
  [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$version = (& node -p "require('./package.json').version").Trim()
if ($LASTEXITCODE -ne 0 -or -not $version) { throw 'Cannot read the package version' }
$outputDir = Join-Path $projectRoot 'dist-build'
$unpackedDir = Join-Path $outputDir 'win-unpacked'
$zipPath = Join-Path $outputDir "AigeiDownloader-$version-win-x64.zip"

Write-Host '[1/3] Building application...'
& node --require ./crypto-polyfill.js node_modules/electron-vite/bin/electron-vite.js build
if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }

if ($SkipInstaller) {
  Write-Host '[2/3] Building unpacked application...'
  & node node_modules/electron-builder/out/cli/cli.js --win dir --x64
} else {
  Write-Host '[2/3] Building Windows installer...'
  & node node_modules/electron-builder/out/cli/cli.js --win nsis --x64
}
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
if (-not (Test-Path -LiteralPath $unpackedDir)) { throw "Unpacked application not found: $unpackedDir" }

Write-Host '[3/3] Compressing portable ZIP...'
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $unpackedDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ''
Write-Host "Portable ZIP: $zipPath"
if (-not $SkipInstaller) {
  $installer = Get-ChildItem -LiteralPath $outputDir -Filter "AigeiDownloader-Setup-$version-*.exe" | Select-Object -First 1
  if (-not $installer) { throw 'Installer EXE not found' }
  Write-Host "Installer:    $($installer.FullName)"
}

