<#
.SYNOPSIS
    Waits for the API's health check and, if given, for the public port to open.
    Throws after the timeout. First start can take a while: it updates the schema.
#>
param(
    [int]$ApiPort = 8019,
    [int]$PublicPort = 8018,
    [int]$TimeoutSeconds = 120,
    [string]$LogFile = ''
)

$ErrorActionPreference = 'Stop'

function Test-Port($port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-Api {
    try {
        $reply = Invoke-WebRequest "http://127.0.0.1:$ApiPort/api/health" -UseBasicParsing -TimeoutSec 5
        return $reply.StatusCode -eq 200
    } catch {
        return $false
    }
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    if ((Test-Api) -and ($PublicPort -eq 0 -or (Test-Port $PublicPort))) {
        Write-Host 'Healthy.' -ForegroundColor Green
        exit 0
    }
    Start-Sleep -Seconds 3
}
throw "Not healthy after $TimeoutSeconds seconds. Check the log: $LogFile"
