<#
.SYNOPSIS
    Installs the IT Asset Engine as Windows services. Safe to run again.

.EXAMPLE
    .\deploy\install.ps1 -ServerName itassets.company.local `
        -CertFile C:\certs\itassets.crt -KeyFile C:\certs\itassets.key `
        -BackupDir D:\backups\asset-management
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ServerName,
    [Parameter(Mandatory)][string]$CertFile,
    [Parameter(Mandatory)][string]$KeyFile,
    [Parameter(Mandatory)][string]$BackupDir,
    [int]$PublicPort = 8018,
    [int]$ApiPort = 8019,
    [string]$NginxExe = 'C:\nginx\nginx.exe',
    [string]$NssmExe = 'nssm'
)

$ErrorActionPreference = 'Stop'

$ApiService = 'AssetManagementAPI'
$WebService = 'AssetManagementWeb'
$BackupTask = 'AssetManagementBackup'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$Runtime = Join-Path $PSScriptRoot 'runtime'
$EnvFile = Join-Path $Backend '.env'
$Python = Join-Path $Backend '.venv\Scripts\python.exe'

function Step($message) { Write-Host "`n== $message" -ForegroundColor Cyan }

function Run($exe) {
    & $exe @args
    if ($LASTEXITCODE -ne 0) { throw "Failed (exit $LASTEXITCODE): $exe $args" }
}

# PowerShell 5.1 writes a BOM with -Encoding utf8, which nginx cannot parse.
function Write-Utf8($path, $content) {
    [IO.File]::WriteAllText($path, $content, (New-Object Text.UTF8Encoding($false)))
}

function ForwardSlashes($path) { return $path.Replace('\', '/') }

function Install-Service($name, $exe, $parameters, $directory, $logName) {
    if (Get-Service $name -ErrorAction SilentlyContinue) {
        & $NssmExe stop $name | Out-Null
        Run $NssmExe remove $name confirm
    }
    Run $NssmExe install $name $exe
    Run $NssmExe set $name AppParameters $parameters
    Run $NssmExe set $name AppDirectory $directory
    Run $NssmExe set $name Start SERVICE_AUTO_START
    Run $NssmExe set $name AppStdout (Join-Path $Runtime "logs\$logName.log")
    Run $NssmExe set $name AppStderr (Join-Path $Runtime "logs\$logName.log")
    Run $NssmExe set $name AppRotateFiles 1
    Run $NssmExe set $name AppRotateBytes 10485760
}

Step 'Checking the server'
$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated (Administrator) PowerShell.'
}
# NSSM parameters are passed without quotes, so these paths cannot hold spaces.
if ($Root -match '\s') { throw "Move the application to a path without spaces (now: $Root)." }
foreach ($file in @($NginxExe, $CertFile, $KeyFile)) {
    if (-not (Test-Path $file)) { throw "Not found: $file" }
}
foreach ($tool in @('python', 'npm', $NssmExe)) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
}
& python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or newer is required.' }

Step 'Checking backend/.env'
if (-not (Test-Path $EnvFile)) {
    $secret = & python -c 'import secrets; print(secrets.token_hex(32))'
    $template = Get-Content (Join-Path $PSScriptRoot 'backend.env.production') -Raw
    Write-Utf8 $EnvFile ($template -replace '(?m)^SECRET_KEY=\r?$', "SECRET_KEY=$secret")
    Write-Host "Created $EnvFile with a new SECRET_KEY."
}
if (Select-String -Path $EnvFile -SimpleMatch 'CHANGE_ME' -Quiet) {
    Write-Host "Replace every CHANGE_ME in $EnvFile, then run this script again." -ForegroundColor Yellow
    exit 1
}

Step 'Installing the backend'
if (-not (Test-Path $Python)) { Run python -m venv (Join-Path $Backend '.venv') }
Run $Python -m pip install --quiet --disable-pip-version-check -r (Join-Path $Backend 'requirements.txt')

Step 'Building the frontend'
Push-Location $Frontend
try {
    Run npm ci
    Run npm run build
} finally {
    Pop-Location
}

Step 'Writing the nginx configuration'
foreach ($dir in @('logs', 'temp')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Runtime $dir) | Out-Null
}
$nginxConf = (Get-Content (Join-Path $PSScriptRoot 'nginx.conf.template') -Raw).
    Replace('@@MIME_TYPES@@', (ForwardSlashes (Join-Path (Split-Path -Parent $NginxExe) 'conf\mime.types'))).
    Replace('@@SERVER_NAME@@', $ServerName).
    Replace('@@PUBLIC_PORT@@', "$PublicPort").
    Replace('@@API_PORT@@', "$ApiPort").
    Replace('@@CERT_FILE@@', (ForwardSlashes (Resolve-Path $CertFile).Path)).
    Replace('@@KEY_FILE@@', (ForwardSlashes (Resolve-Path $KeyFile).Path)).
    Replace('@@DIST_DIR@@', (ForwardSlashes (Join-Path $Frontend 'dist')))
Write-Utf8 (Join-Path $Runtime 'nginx.conf') $nginxConf
$nginxPrefix = (ForwardSlashes $Runtime) + '/'
Run $NginxExe -p $nginxPrefix -c nginx.conf -t

Step 'Registering the services'
Install-Service $ApiService $Python "deploy\serve.py --port $ApiPort" $Root 'api'
Install-Service $WebService $NginxExe "-p $nginxPrefix -c nginx.conf" (Split-Path -Parent $NginxExe) 'nginx-service'

Step 'Opening the firewall'
$ruleName = "IT Asset Engine HTTPS $PublicPort"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort $PublicPort -Action Allow | Out-Null
}

Step 'Scheduling the nightly backup (02:00, kept 30 days)'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$action = New-ScheduledTaskAction -Execute $Python -WorkingDirectory $Backend `
    -Argument "scripts\backup_db.py --out `"$BackupDir`" --keep 30"
$trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Register-ScheduledTask -TaskName $BackupTask -Action $action -Trigger $trigger `
    -Principal $principal -Force | Out-Null

Step 'Starting the services'
Start-Service $ApiService
& (Join-Path $PSScriptRoot 'wait-healthy.ps1') -ApiPort $ApiPort -PublicPort 0 -LogFile (Join-Path $Runtime 'logs\api.log')
Start-Service $WebService
& (Join-Path $PSScriptRoot 'wait-healthy.ps1') -ApiPort $ApiPort -PublicPort $PublicPort -LogFile (Join-Path $Runtime 'logs\nginx-error.log')

Write-Host "`nInstalled: https://${ServerName}:$PublicPort" -ForegroundColor Green
