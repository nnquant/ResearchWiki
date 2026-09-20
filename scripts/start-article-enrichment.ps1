param([string]$LlmConfig = '', [string]$Output = '', [ValidateRange(0,16)][int]$Concurrency = 0, [switch]$WatchReports)
$ErrorActionPreference = 'Stop'
$articleRepo = Split-Path $PSScriptRoot -Parent
$articleConfig = Get-Content -LiteralPath (Join-Path $articleRepo 'config.json') -Raw | ConvertFrom-Json
$articleState = Join-Path $articleConfig.dataRoot 'state\article-enrichment'
if (-not $LlmConfig) { $LlmConfig = Join-Path $articleRepo 'work\article-llm.json' }
if (-not $Output) { $Output = Join-Path $articleRepo 'work\article-metadata-batch' }
if (-not (Test-Path -LiteralPath $LlmConfig)) { throw '缺少私有 LLM 配置' }
New-Item -ItemType Directory -Path $articleState -Force | Out-Null
$articleLock = Join-Path $articleState 'worker.lock'
$articleScript = Join-Path $articleRepo 'scripts\enrich-articles-worker.mjs'
if (Test-Path -LiteralPath $articleLock) {
    $articleOwner = Get-Content -LiteralPath $articleLock -Raw | ConvertFrom-Json
    $articleProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($articleOwner.pid)" -ErrorAction SilentlyContinue
    if ($articleProcess) {
        if ($articleProcess.CommandLine.Contains($articleScript)) { Write-Output "文章抽取已运行，PID $($articleOwner.pid)"; return }
        throw '锁 PID 属于其他进程，未启动新任务'
    }
    Remove-Item -LiteralPath $articleLock
}
if (Test-Path -LiteralPath (Join-Path $articleState 'pause')) { throw '存在暂停标记，未启动任务' }
$articleArgs = @(('"' + $articleScript + '"'), '--config', ('"' + $LlmConfig + '"'), '--output', ('"' + $Output + '"'))
if ($Concurrency -gt 0) { $articleArgs += @('--concurrency', [string]$Concurrency) }
if ($WatchReports) { $articleArgs += '--watch-reports' }
$articleWorker = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $articleArgs -WorkingDirectory $articleRepo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $articleState 'worker.stdout.log') -RedirectStandardError (Join-Path $articleState 'worker.stderr.log') -PassThru
for ($articleAttempt=0; $articleAttempt -lt 20; $articleAttempt++) {
    $articleWorker.Refresh()
    if ($articleWorker.HasExited) { throw '文章抽取进程已退出，请检查 worker.stderr.log' }
    if (Test-Path -LiteralPath $articleLock) {
        $articleRunning = Get-Content -LiteralPath $articleLock -Raw | ConvertFrom-Json
        if ($articleRunning.pid -eq $articleWorker.Id) { Write-Output "文章抽取已启动，PID $($articleWorker.Id)，并发 $($articleRunning.concurrency)，模式：整篇抽取、逐篇入库和索引，不翻译"; return }
    }
    Start-Sleep -Milliseconds 500
}
throw '文章抽取未能及时取得运行锁'
