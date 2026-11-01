<#
.SYNOPSIS
    Releases the latest code: pulls, builds, backs up the database, restarts.
    The backup comes first because every API start can change the schema.

.EXAMPLE
    .\deploy\update.ps1 -BackupDir D:\backups\asset-management
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupDir,
    [int]$PublicPort = 8018,
    [int]$ApiPort = 8019
)

$ErrorActionPreference = 'Stop'

$ApiService = 'AssetManagementAPI'
$WebService = 'AssetManagementWeb'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$Python = Join-Path $Backend '.venv\Scripts\python.exe'

function Step($message) { Write-Host "`n== $message" -ForegroundColor Cyan }

function Run($exe) {
    & $exe @args
    if ($LASTEXITCODE -ne 0) { throw "Failed (exit $LASTEXITCODE): $exe $args" }
}

Step 'Pulling the latest code'
Run git -C $Root pull --ff-only

Step 'Building the frontend'
Push-Location $Frontend
try {
    Run npm ci
    Run npm run build
} finally {
    Pop-Location
}

Step 'Backing up the database'
Push-Location $Backend
try {
    Run $Python scripts\backup_db.py --out $BackupDir --keep 30
} finally {
    Pop-Location
}

Step 'Restarting the API'
Stop-Service $ApiService
Run $Python -m pip install --quiet --disable-pip-version-check -r (Join-Path $Backend 'requirements.txt')
Start-Service $ApiService
& (Join-Path $PSScriptRoot 'wait-healthy.ps1') -ApiPort $ApiPort -PublicPort $PublicPort -LogFile (Join-Path $PSScriptRoot 'runtime\logs\api.log')

Restart-Service $WebService
Write-Host "`nUpdate complete." -ForegroundColor Green
