$ErrorActionPreference = 'Stop'
$agentRepo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$agentConfig = Get-Content (Join-Path $agentRepo 'config.json') -Raw | ConvertFrom-Json
if ($agentConfig.agent.enabled -eq $false) { return }
$agentPort = if ($agentConfig.agent.port) { $agentConfig.agent.port } else { $agentConfig.port + 2 }
$agentProbeHost = if ($agentConfig.agent.host) { $agentConfig.agent.host } else { $agentConfig.host }
if ($agentProbeHost -in @('0.0.0.0', '::')) { $agentProbeHost = '127.0.0.1' }
if ($agentProbeHost.Contains(':')) { $agentProbeHost = "[$agentProbeHost]" }
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ([DateTime]::UtcNow -lt $deadline) {
    try {
        $probe = Invoke-WebRequest "http://${agentProbeHost}:$agentPort/health" -SkipHttpErrorCheck -TimeoutSec 2
        if ($probe.StatusCode -eq 401) { Write-Host "ResearchWiki Agent 端口 $agentPort 已就绪，需要 Bearer token。"; return }
    } catch { }
    Start-Sleep -Milliseconds 250
}
throw 'Agent 服务未就绪；升级已有进程后请运行 scripts/restart-wiki.ps1 并检查日志。'
