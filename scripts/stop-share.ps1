. "$PSScriptRoot/common.ps1"
foreach($name in @('share-tunnel','share-gateway')){
 $pidFile=Join-Path $ProjectRoot "data/$name.pid"
 if(Test-Path $pidFile){
  $idNumber=[int](Get-Content $pidFile);$process=Get-Process -Id $idNumber -ErrorAction SilentlyContinue
  if($process){
   $details=Get-CimInstance Win32_Process -Filter "ProcessId=$idNumber"
   $belongs=if($name -eq 'share-tunnel'){$process.Path -eq [IO.Path]::GetFullPath((Join-Path $ProjectRoot '.deps/cloudflared/cloudflared.exe'))}else{$process.ProcessName -eq 'node' -and $details.CommandLine -like '*scripts/share-server.cjs*'}
   if(-not $belongs){throw "Cannot verify ownership of $name PID $idNumber"}
   Stop-Process -Id $idNumber
  }
  Remove-Item -LiteralPath $pidFile
 }
}
Write-Host 'Public sharing stopped. Local app remains available.'
