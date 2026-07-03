$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $ProjectRoot "logs"
$LogFile = Join-Path $LogDir "market-agent.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectRoot

Add-Content -Path $LogFile -Value ""
Add-Content -Path $LogFile -Value "===== Funtastic local market agent started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====="

if (-not (Test-Path (Join-Path $ProjectRoot ".env.local"))) {
  Add-Content -Path $LogFile -Value "ERROR: .env.local not found."
  exit 1
}

& npm.cmd run agent:start *>> $LogFile
