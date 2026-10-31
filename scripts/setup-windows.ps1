param([string]$MySqlRoot, [string]$DependencyRoot)
. "$PSScriptRoot/common.ps1"
Import-ProjectEnv
if (-not $MySqlRoot) { $MySqlRoot = Find-MySqlRoot }
if (-not $DependencyRoot) {
    $pythonDirectory = Split-Path (Get-Command python.exe).Source -Parent
    $DependencyRoot = Join-Path $pythonDirectory 'Library'
}
if (-not (Test-Path (Join-Path $DependencyRoot 'include/boost/beast.hpp'))) {
    throw 'Pass -DependencyRoot with Boost and OpenSSL include/lib/bin folders, or use vcpkg. See docs/windows.md.'
}
New-Item -ItemType Directory -Force .deps/include/nlohmann | Out-Null
if (-not (Test-Path .deps/include/nlohmann/json.hpp)) {
    if (Test-Path data/cpp-headers/nlohmann/json.hpp) { Copy-Item data/cpp-headers/nlohmann/json.hpp .deps/include/nlohmann/json.hpp }
    else { Invoke-WebRequest 'https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp' -OutFile .deps/include/nlohmann/json.hpp }
}
& cmake -S server -B build/windows -G 'Visual Studio 17 2022' -A x64 "-DMYSQL_ROOT=$MySqlRoot" "-DBOOST_ROOT=$DependencyRoot" '-DBoost_NO_BOOST_CMAKE=ON' "-DOPENSSL_ROOT_DIR=$DependencyRoot" "-DJSON_INCLUDE_DIR=$ProjectRoot/.deps/include"
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed' }
& cmake --build build/windows --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'C++ compilation failed' }
foreach ($dll in @((Join-Path $MySqlRoot 'lib/libmysql.dll'), (Join-Path $DependencyRoot 'bin/libcrypto-3-x64.dll'), (Join-Path $DependencyRoot 'bin/libssl-3-x64.dll'))) {
    if (Test-Path $dll) { Copy-Item $dll build/windows/Release/ -Force }
}
if (-not (Test-Path .venv/Scripts/python.exe)) { & python -m venv .venv }
& python -m pip --isolated --python .venv/Scripts/python.exe install -r ai/requirements.txt pymysql==1.1.1 cryptography pytest websockets==14.1
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed' }
& .venv/Scripts/python.exe scripts/setup-ai-models.py
if ($LASTEXITCODE -ne 0) { throw 'Local semantic model setup failed' }
Push-Location web
try { & npm.cmd ci --no-audit --no-fund --offline=false --cache .npm-cache; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }; & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' } } finally { Pop-Location }
Write-Host 'Setup complete. Run: powershell -ExecutionPolicy Bypass -File scripts/start-windows.ps1'
