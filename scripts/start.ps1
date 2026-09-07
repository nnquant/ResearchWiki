$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot
$dataRoot = 'D:\data\gbrain'
docker compose --env-file "$dataRoot\runtime\compose.env" up -d
if ($LASTEXITCODE -ne 0) { throw '数据库或 embedding 服务启动失败' }
$env:GBRAIN_HOME = "$dataRoot\runtime"
$env:GBRAIN_SOURCE = 'default'
$env:OLLAMA_BASE_URL = 'http://127.0.0.1:11435/v1'
$nodeExe = (Get-Command node.exe).Source
$bunExe = Join-Path $repoRoot 'node_modules\bun\bin\bun.exe'
$stateFile = "$dataRoot\state\services.json"
$services = @{}
if (Test-Path $stateFile) {
    $old = Get-Content $stateFile -Raw | ConvertFrom-Json -AsHashtable
    foreach ($entry in $old.GetEnumerator()) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.Value.pid)" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine.Contains($repoRoot)) { $services[$entry.Key] = $entry.Value }
    }
}
if (-not $services.ContainsKey('wiki')) {
    if (-not (Test-Path (Join-Path $repoRoot 'web\dist\index.html'))) { throw '前端尚未构建，请先运行 npm run build' }
    if (Get-NetTCPConnection -State Listen -LocalPort 8018 -ErrorAction SilentlyContinue) { throw '8018 端口已被其他进程占用' }
    $wikiProc = Start-Process -FilePath $nodeExe -ArgumentList @((Join-Path $repoRoot 'scripts\wiki.mjs'),'serve') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput "$dataRoot\logs\wiki.stdout.log" -RedirectStandardError "$dataRoot\logs\wiki.stderr.log" -PassThru
    $services.wiki = @{pid=$wikiProc.Id;port=8018}
}
if (-not $services.ContainsKey('mcp')) {
    if (Get-NetTCPConnection -State Listen -LocalPort 3131 -ErrorAction SilentlyContinue) { throw '3131 端口已被其他进程占用' }
    $adminTokenFile = Join-Path $dataRoot 'runtime\admin-token'
    if (-not (Test-Path -LiteralPath $adminTokenFile)) {
        $tokenBytes = [byte[]]::new(32)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
        [Convert]::ToHexString($tokenBytes).ToLowerInvariant() | Set-Content -LiteralPath $adminTokenFile -Encoding ascii -NoNewline
    }
    $env:GBRAIN_ADMIN_BOOTSTRAP_TOKEN = (Get-Content -LiteralPath $adminTokenFile -Raw).Trim()
    # The Wiki 前端通过 MCP 做检索；默认 30 次/分钟的限速对本机交互式搜索太低。仅监听 127.0.0.1。
    $env:GBRAIN_HTTP_RATE_LIMIT_IP = '600'
    $env:GBRAIN_HTTP_RATE_LIMIT_TOKEN = '600'
    $mcpProc = Start-Process -FilePath $bunExe -ArgumentList @((Join-Path $repoRoot 'vendor\gbrain\src\cli.ts'),'serve','--http','--port','3131','--bind','127.0.0.1','--surface','starter') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput "$dataRoot\logs\mcp.stdout.log" -RedirectStandardError "$dataRoot\logs\mcp.stderr.log" -PassThru
    Remove-Item Env:\GBRAIN_ADMIN_BOOTSTRAP_TOKEN
    Remove-Item Env:\GBRAIN_HTTP_RATE_LIMIT_IP
    Remove-Item Env:\GBRAIN_HTTP_RATE_LIMIT_TOKEN
    $services.mcp = @{pid=$mcpProc.Id;port=3131}
}
$services | ConvertTo-Json -Depth 5 | Set-Content $stateFile -Encoding utf8
Write-Host 'Wiki: http://127.0.0.1:8018'
Write-Host 'MCP:  http://127.0.0.1:3131/mcp'
& (Join-Path $PSScriptRoot 'start-import-watch.ps1')
