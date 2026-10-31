. "$PSScriptRoot/common.ps1"
Import-ProjectEnv
$pidFile=Join-Path $ProjectRoot 'data/ai.pid'
if(Test-Path $pidFile){
 $idNumber=[int](Get-Content $pidFile)
 $process=Get-Process -Id $idNumber -ErrorAction SilentlyContinue
 if($process){
  $details=Get-CimInstance Win32_Process -Filter "ProcessId=$idNumber"
  if($details.CommandLine -notlike '*scripts/service.py*ai*'){throw 'Cannot verify AI process ownership'}
  Stop-Process -Id $idNumber
 }
}
$process=Start-Process "$ProjectRoot/.venv/Scripts/python.exe" -ArgumentList @('scripts/service.py','ai') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput data/logs/ai.out.log -RedirectStandardError data/logs/ai.err.log
Start-Sleep -Seconds 2
if($process.HasExited){throw 'AI startup failed; check data/logs/ai.err.log'}
Write-Host 'AI restarted. Chat and public tunnel remain running. LLM settings now reload on every request.'
