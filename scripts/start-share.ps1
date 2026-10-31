. "$PSScriptRoot/common.ps1"
if(-not(Test-Path .deps/cloudflared/cloudflared.exe)){throw 'Download official cloudflared to .deps/cloudflared/cloudflared.exe first.'}
if(-not(Test-Path web/dist/index.html)){throw 'Build the frontend first: cd web; npm run build'}
$null=Invoke-WebRequest http://127.0.0.1:8081/api/health -UseBasicParsing -TimeoutSec 5
if(Test-Path data/share-tunnel.pid){$idNumber=[int](Get-Content data/share-tunnel.pid);if(Get-Process -Id $idNumber -ErrorAction SilentlyContinue){throw 'Share already running. Use scripts/stop-share.ps1 first.'}}
$random=[Security.Cryptography.RandomNumberGenerator]::Create();$bytes=New-Object byte[] 12;$random.GetBytes($bytes);$password=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
@{password=$password;created=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -Encoding utf8 data/share-access.json
$gateway=Start-Process node -ArgumentList @('scripts/share-server.cjs') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput data/logs/share-gateway.out.log -RedirectStandardError data/logs/share-gateway.err.log
[IO.File]::WriteAllText((Join-Path $ProjectRoot 'data/share-gateway.pid'),[string]$gateway.Id)
Start-Sleep -Seconds 1
if($gateway.HasExited){throw 'Share gateway failed. See data/logs/share-gateway.err.log'}
$tunnel=Start-Process '.deps/cloudflared/cloudflared.exe' -ArgumentList @('tunnel','--url','http://127.0.0.1:8787','--no-autoupdate','--protocol','http2') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput data/logs/share-tunnel.out.log -RedirectStandardError data/logs/share-tunnel.err.log
[IO.File]::WriteAllText((Join-Path $ProjectRoot 'data/share-tunnel.pid'),[string]$tunnel.Id)
$url=$null
for($i=0;$i -lt 45;$i++){
 Start-Sleep -Seconds 1
 if($tunnel.HasExited){throw 'Tunnel failed. See data/logs/share-tunnel.err.log'}
 $log=Get-Content data/logs/share-tunnel.err.log -Raw -ErrorAction SilentlyContinue
 if($log -match 'https://[a-z0-9-]+\.trycloudflare\.com'){$url=$matches[0];break}
}
if(-not $url){throw 'No share URL yet. Check data/logs/share-tunnel.err.log'}
[IO.File]::WriteAllText((Join-Path $ProjectRoot 'data/share-url.txt'),$url)
Write-Host "Share URL: $url"
Write-Host "Access password: $password"
Write-Host 'Keep this computer and app services running. Stop with scripts/stop-share.ps1.'
