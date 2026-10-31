param([switch]$NoBrowser)
. "$PSScriptRoot/common.ps1"
Import-ProjectEnv
$env:DB_PASSWORD = $env:MYSQL_PASSWORD
if (-not (Test-Path build/windows/Release/im_server.exe)) { throw 'Run scripts/setup-windows.ps1 first.' }
$mysqlRoot = Find-MySqlRoot
$mysqlExe = Join-Path $mysqlRoot 'bin/mysqld.exe'
$mysqlData = $env:SMART_IM_DB_DIR
New-Item -ItemType Directory -Force $mysqlData | Out-Null
function Start-ProjectProcess($Name,$File,$Arguments) {
    $pidFile=Join-Path $ProjectRoot "data/$Name.pid"
    if (Test-Path $pidFile) {
        $oldId=[int](Get-Content $pidFile)
        if (Get-Process -Id $oldId -ErrorAction SilentlyContinue) { Write-Host "$Name already running ($oldId)"; return }
    }
    $launch=@{FilePath=$File;WorkingDirectory=$ProjectRoot;WindowStyle='Hidden';PassThru=$true;RedirectStandardOutput="data/logs/$Name.out.log";RedirectStandardError="data/logs/$Name.err.log"}
    if($Arguments.Count -gt 0){$launch.ArgumentList=$Arguments}
    $process=Start-Process @launch
    [IO.File]::WriteAllText($pidFile,[string]$process.Id)
    Start-Sleep -Milliseconds 600
    if ($process.HasExited) { throw "$Name exited. Check data/logs/$Name.err.log" }
}
if (-not (Test-Path (Join-Path $mysqlData 'mysql'))) {
    & $mysqlExe --no-defaults --initialize-insecure "--basedir=$mysqlRoot" "--datadir=$mysqlData" --console
    if ($LASTEXITCODE -ne 0) { throw 'Project database initialization failed' }
}
$env:SMART_IM_MYSQL_ROOT=$mysqlRoot
Start-ProjectProcess 'mysql-wrapper' "$ProjectRoot/.venv/Scripts/python.exe" @('scripts/service.py','mysql')
& .venv/Scripts/python.exe scripts/bootstrap_db.py
if ($LASTEXITCODE -ne 0) { throw 'Database setup failed' }
Start-ProjectProcess 'ai' "$ProjectRoot/.venv/Scripts/python.exe" @('scripts/service.py','ai')
Start-ProjectProcess 'server' "$ProjectRoot/build/windows/Release/im_server.exe" @()
Start-ProjectProcess 'web' "$ProjectRoot/.venv/Scripts/python.exe" @('scripts/service.py','web')
Write-Host 'Open http://localhost:8080 . Set DEEPSEEK_API_KEY in .env; native AI reloads the key automatically.'
if (-not $NoBrowser) { Start-Process 'http://localhost:8080' }
