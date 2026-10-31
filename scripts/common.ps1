$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $ProjectRoot
function Import-ProjectEnv {
    if (-not (Test-Path -LiteralPath '.env')) { & python scripts/configure.py }
    foreach ($line in Get-Content -LiteralPath '.env' -Encoding UTF8) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
    $env:DB_HOST = '127.0.0.1'
    $env:DB_PORT = '3307'
    $env:DB_USER = 'im'
    $env:DB_NAME = 'smart_im'
    $env:AI_HOST = '127.0.0.1'
    $env:AI_PORT = '8000'
    $env:SERVER_PORT = '8081'
    $env:BIND_HOST = '127.0.0.1'
    $env:FILE_DIR = Join-Path $ProjectRoot 'data/files'
    $env:INDEX_DIR = Join-Path $ProjectRoot 'data/index'
    $env:PYTHONUTF8 = '1'
    if (-not $env:SMART_IM_DB_DIR) {
        $hasher=[Security.Cryptography.SHA256]::Create()
        $projectHash=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($ProjectRoot)))).Replace('-','').Substring(0,12)
        $env:SMART_IM_DB_DIR=Join-Path $env:LOCALAPPDATA "QingLiao/$projectHash/mysql"
    }
    New-Item -ItemType Directory -Force data/files,data/index,data/logs | Out-Null
}
function Find-MySqlRoot {
    if ($env:SMART_IM_MYSQL_ROOT) { return $env:SMART_IM_MYSQL_ROOT }
    if (Test-Path 'D:/bin/mysqld.exe') { return 'D:/' }
    $mysqlCommand = Get-Command mysqld.exe -ErrorAction SilentlyContinue
    if ($mysqlCommand) { return Split-Path (Split-Path $mysqlCommand.Source -Parent) -Parent }
    foreach ($path in @('C:/Program Files/MySQL/MySQL Server 8.0','C:/Program Files/MySQL/MySQL Server 8.4')) {
        if (Test-Path (Join-Path $path 'bin/mysqld.exe')) { return $path }
    }
    throw 'MySQL not found. Set SMART_IM_MYSQL_ROOT to your MySQL installation directory.'
}
