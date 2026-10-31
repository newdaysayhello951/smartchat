. "$PSScriptRoot/common.ps1"
Import-ProjectEnv
if(Test-Path data/share-tunnel.pid){& "$PSScriptRoot/stop-share.ps1"}
foreach ($name in @('vite','web','server','ai','mysql')) {
    $pidFile=Join-Path $ProjectRoot "data/$name.pid"
    if (Test-Path $pidFile) {
        $idNumber=[int](Get-Content $pidFile)
        $process=Get-Process -Id $idNumber -ErrorAction SilentlyContinue
        if ($process) {
            $expected=if($name -eq 'mysql'){'mysqld'}elseif($name -eq 'server'){'im_server'}elseif($name -eq 'vite'){'node'}else{'python'}
            if ($process.ProcessName -ne $expected) { throw "PID $idNumber no longer belongs to $name; refusing to stop." }
            $details=Get-CimInstance Win32_Process -Filter "ProcessId=$idNumber"
            if(-not $details){Remove-Item -LiteralPath $pidFile;continue}
            $belongs=if($name -eq 'server'){$process.Path -eq [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'build/windows/Release/im_server.exe'))}elseif($name -eq 'mysql'){$details.CommandLine -like '*--port=3307*' -and $details.CommandLine -like "*$env:SMART_IM_DB_DIR*"}elseif($name -eq 'vite'){$details.CommandLine -like '*vite/bin/vite.js*' -and $details.CommandLine -like '*8080*'}else{$details.CommandLine -like "*scripts/service.py*$name*"}
            if(-not $belongs){throw "Cannot verify $name process ownership; refusing to stop PID $idNumber."}
            if($name -eq 'mysql') {
                $env:MYSQL_PWD=$env:MYSQL_ROOT_PASSWORD
                & (Join-Path (Find-MySqlRoot) 'bin/mysqladmin.exe') --protocol=TCP --host=127.0.0.1 --port=3307 --user=root shutdown
                Remove-Item Env:MYSQL_PWD
                if($LASTEXITCODE -ne 0){throw 'Project MySQL shutdown failed; left running.'}
            } else { Stop-Process -Id $idNumber }
        }
        Remove-Item -LiteralPath $pidFile
    }
}
Write-Host 'Project services stopped.'
