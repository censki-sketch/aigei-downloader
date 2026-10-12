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

function Write-GitHubError {
  param([string]$Title, [string]$Message)

  if ($env:GITHUB_ACTIONS -ne 'true') { return }

  $escapedTitle = $Title.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  $escapedMessage = $Message.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Host "::error title=$escapedTitle::$escapedMessage"
}

function Invoke-BuildCommand {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $commandOutput = @(& $FilePath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $textOutput = @($commandOutput | ForEach-Object { $_.ToString() })
  $textOutput | ForEach-Object { Write-Host $_ }

  if ($exitCode -ne 0) {
    $tail = ($textOutput | Select-Object -Last 25 | Out-String).Trim()
    $message = "$Name failed with exit code $exitCode"
    if ($tail) { $message += "`n$tail" }
    Write-GitHubError -Title "$Name failed" -Message $message
    throw $message
  }
}

Write-Host '[1/3] Building application...'
Invoke-BuildCommand -Name 'Application build' -FilePath 'node' -Arguments @(
  '--require', './crypto-polyfill.js',
  'node_modules/electron-vite/bin/electron-vite.js',
  'build'
)

if ($SkipInstaller) {
  Write-Host '[2/3] Building unpacked application...'
  $builderTarget = 'dir'
} else {
  Write-Host '[2/3] Building Windows installer...'
  $builderTarget = 'nsis'
}
Invoke-BuildCommand -Name 'Windows packaging' -FilePath 'node' -Arguments @(
  'node_modules/electron-builder/out/cli/cli.js',
  '--win', $builderTarget,
  '--x64',
  '--publish', 'never'
)
if (-not (Test-Path -LiteralPath $unpackedDir)) { throw "Unpacked application not found: $unpackedDir" }

Write-Host '[3/3] Compressing portable ZIP...'
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $unpackedDir,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
} catch {
  Write-GitHubError -Title 'Portable ZIP creation failed' -Message $_.Exception.Message
  throw
}

Write-Host ''
Write-Host "Portable ZIP: $zipPath"
if (-not $SkipInstaller) {
  $installer = Get-ChildItem -LiteralPath $outputDir -Filter "AigeiDownloader-Setup-$version-*.exe" | Select-Object -First 1
  if (-not $installer) { throw 'Installer EXE not found' }
  Write-Host "Installer:    $($installer.FullName)"
}

