$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$wikiConfig = Get-Content (Join-Path $repoRoot 'config.json') -Raw | ConvertFrom-Json
$dataRoot = [IO.Path]::GetFullPath($wikiConfig.dataRoot, $repoRoot)
$stateFile = Join-Path $dataRoot 'state/services.json'
$services = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json -AsHashtable
$status = Invoke-RestMethod "http://127.0.0.1:$($wikiConfig.port)/api/status" -TimeoutSec 10
if ($status.active -or $status.queue -gt 0) { throw 'Wiki 有正在运行或排队的导入任务，请完成后再重启。' }
$wikiPid = $services.wiki.pid
$wikiProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$wikiPid"
if (-not $wikiProcess -or -not $wikiProcess.CommandLine.Contains((Join-Path $repoRoot 'scripts\wiki.mjs'))) { throw 'Wiki 进程身份不匹配，未停止任何进程。' }
$agentEnabled = $wikiConfig.agent.enabled -ne $false
$agentPort = if ($wikiConfig.agent.port) { $wikiConfig.agent.port } else { $wikiConfig.port + 2 }
$agentProbeHost = if ($wikiConfig.agent.host) { $wikiConfig.agent.host } else { $wikiConfig.host }
if ($agentProbeHost -in @('0.0.0.0', '::')) { $agentProbeHost = '127.0.0.1' }
if ($agentProbeHost.Contains(':')) { $agentProbeHost = "[$agentProbeHost]" }
if ($agentEnabled) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $agentPort -ErrorAction SilentlyContinue
    if ($listener -and @($listener | Where-Object OwningProcess -ne $wikiPid).Count -gt 0) { throw "Agent 端口 $agentPort 已被其他进程占用，未重启。" }
}
Stop-Process -Id $wikiPid
$nodeExe = (Get-Command node).Source
$wikiProc = Start-Process -FilePath $nodeExe -ArgumentList @((Join-Path $repoRoot 'scripts\wiki.mjs'), 'serve') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput "$dataRoot\logs\wiki.stdout.log" -RedirectStandardError "$dataRoot\logs\wiki.stderr.log" -PassThru
$services.wiki = @{ pid=$wikiProc.Id; port=$wikiConfig.port }
$services | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding utf8
$ready = $false
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ([DateTime]::UtcNow -lt $deadline) {
    try {
        $null = Invoke-RestMethod "http://127.0.0.1:$($wikiConfig.port)/api/status" -TimeoutSec 2
        if ($agentEnabled) {
            $probe = Invoke-WebRequest "http://${agentProbeHost}:$agentPort/health" -SkipHttpErrorCheck -TimeoutSec 2
            if ($probe.StatusCode -ne 401) { throw 'Agent 鉴权入口未就绪' }
        }
        $ready = $true; break
    } catch { Start-Sleep -Milliseconds 250 }
}
if (-not $ready) { throw 'Wiki 未能在 20 秒内就绪，请检查 logs/wiki.stderr.log。' }
Write-Output "Wiki 已重启，PID $($wikiProc.Id)，端口 $($wikiConfig.port)"
if ($agentEnabled) { Write-Output "只读 Agent HTTP/MCP 端口 $agentPort 已就绪，需要 Bearer token。" }
