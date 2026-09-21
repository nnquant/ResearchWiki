$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\deployment.ps1"
Set-Location $repoRoot

if ($wikiConfig.sharedApi.enabled -and -not $env:QUANT_API_KEY) { throw '请配置内网服务 QUANT_API_KEY 或 sharedApi.apiKeyFile' }
node scripts/patch-gbrain.mjs
if ($LASTEXITCODE -ne 0) { throw 'GBrain 兼容检查失败' }
$composeServices = @(if ($wikiConfig.sharedApi.enabled) { 'postgres' } else { 'postgres'; 'embeddings' })
docker compose @composeArgs up -d --wait @composeServices
if ($LASTEXITCODE -ne 0) { throw '数据库或 embedding 服务启动失败' }
$env:GBRAIN_HOME = "$dataRoot\runtime"
$env:GBRAIN_SOURCE = 'default'
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
    if (Get-NetTCPConnection -State Listen -LocalPort $wikiConfig.port -ErrorAction SilentlyContinue) { throw "Wiki 端口 $($wikiConfig.port) 已被其他进程占用" }
    Backup-WikiLogs
    $wikiProc = Start-Process -FilePath $nodeExe -ArgumentList @((Join-Path $repoRoot 'scripts\wiki.mjs'),'serve') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput "$dataRoot\logs\wiki.stdout.log" -RedirectStandardError "$dataRoot\logs\wiki.stderr.log" -PassThru
    $services.wiki = @{pid=$wikiProc.Id;port=$wikiConfig.port}
}
if (-not $services.ContainsKey('mcp')) {
    if (Get-NetTCPConnection -State Listen -LocalPort $wikiConfig.mcpPort -ErrorAction SilentlyContinue) { throw "MCP 端口 $($wikiConfig.mcpPort) 已被其他进程占用" }
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
    $mcpProc = Start-Process -FilePath $bunExe -ArgumentList @('--preload',(Join-Path $repoRoot 'scripts\gbrain-shared-preload.mjs'),(Join-Path $repoRoot 'vendor\gbrain\src\cli.ts'),'serve','--http','--port',([string]$wikiConfig.mcpPort),'--bind','127.0.0.1','--surface','starter') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput "$dataRoot\logs\mcp.stdout.log" -RedirectStandardError "$dataRoot\logs\mcp.stderr.log" -PassThru
    Remove-Item Env:\GBRAIN_ADMIN_BOOTSTRAP_TOKEN
    Remove-Item Env:\GBRAIN_HTTP_RATE_LIMIT_IP
    Remove-Item Env:\GBRAIN_HTTP_RATE_LIMIT_TOKEN
    $services.mcp = @{pid=$mcpProc.Id;port=$wikiConfig.mcpPort}
}
$services | ConvertTo-Json -Depth 5 | Set-Content $stateFile -Encoding utf8
$ready = $false
$agentEnabled = $wikiConfig.agent.enabled -ne $false
$agentPort = if ($wikiConfig.agent.port) { $wikiConfig.agent.port } else { $wikiConfig.port + 2 }
$agentProbeHost = if ($wikiConfig.agent.host) { $wikiConfig.agent.host } else { $wikiConfig.host }
if ($agentProbeHost -in @('0.0.0.0', '::')) { $agentProbeHost = '127.0.0.1' }
if ($agentProbeHost.Contains(':')) { $agentProbeHost = "[$agentProbeHost]" }
$readyDeadline = [DateTime]::UtcNow.AddSeconds(45)
while ([DateTime]::UtcNow -lt $readyDeadline) {
    try {
        $mcpReady = Invoke-RestMethod "http://127.0.0.1:$($wikiConfig.mcpPort)/health" -TimeoutSec 2
        $wikiReady = Invoke-WebRequest "http://127.0.0.1:$($wikiConfig.port)/" -TimeoutSec 2
        $agentReady = -not $agentEnabled
        if ($agentEnabled) {
            $agentProbe = Invoke-WebRequest "http://${agentProbeHost}:$agentPort/health" -SkipHttpErrorCheck -TimeoutSec 2
            $agentReady = $agentProbe.StatusCode -eq 401
        }
        if ($mcpReady.status -eq 'ok' -and $wikiReady.StatusCode -eq 200 -and $agentReady) { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Wiki、Agent 或内部 MCP 未在 45 秒内就绪；升级已有进程后请使用 scripts/restart-wiki.ps1，并检查数据目录 logs。' }
Write-Host "Wiki: http://127.0.0.1:$($wikiConfig.port)"
Write-Host "MCP:  http://127.0.0.1:$($wikiConfig.mcpPort)/mcp"
if ($agentEnabled) { Write-Host "Agent: 端口 $agentPort，/mcp 和 /api/research/*，需要 Bearer token。" }
& (Join-Path $PSScriptRoot 'start-import-watch.ps1')
