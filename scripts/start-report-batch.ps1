param(
    [string]$Source = 'D:\data\reports\raw',
    [string]$Output = 'D:\data\reports\processed',
    [int]$Year = 2026,
    [int]$FromMonth = 9,
    [int]$ToMonth = 5,
    [int]$BatchSize = 5,
    [switch]$RetryFailed,
    [switch]$ParseOnly,
    [ValidateRange(1,4)][int]$Concurrency = 1
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\deployment.ps1"
Set-Location $repoRoot
$outputRoot = [IO.Path]::GetFullPath($Output)
$batchDir = Join-Path $outputRoot '_batch'
New-Item -ItemType Directory -Force -Path $batchDir | Out-Null
if (Test-Path -LiteralPath (Join-Path $batchDir 'layout.lock')) { throw '输出目录迁移正在进行' }
$layoutState = Join-Path $batchDir 'layout-date-migration.json'
if (Test-Path -LiteralPath $layoutState) {
    if ((Get-Content -LiteralPath $layoutState -Raw | ConvertFrom-Json).status -ne 'completed') { throw '输出目录迁移未完成，请先恢复迁移' }
}
$workerState = Join-Path $batchDir 'worker.json'
if (-not $PSBoundParameters.ContainsKey('ParseOnly') -and (Test-Path -LiteralPath $workerState)) {
    $savedWorker = Get-Content -LiteralPath $workerState -Raw | ConvertFrom-Json
    $ParseOnly = $savedWorker.mode -eq 'parse_only'
}
if (-not $PSBoundParameters.ContainsKey('Concurrency') -and (Test-Path -LiteralPath $workerState)) {
    $savedWorker = Get-Content -LiteralPath $workerState -Raw | ConvertFrom-Json
    if ($savedWorker.concurrency) { $Concurrency = [int]$savedWorker.concurrency }
}
if (-not $ParseOnly) { $Concurrency = 1 }
$workerFile = Join-Path $batchDir 'worker.lock'
$batchScript = Join-Path $repoRoot 'scripts\import-report-batch.mjs'
if (Test-Path -LiteralPath $workerFile) {
    $owner = Get-Content -LiteralPath $workerFile -Raw | ConvertFrom-Json
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)" -ErrorAction SilentlyContinue
    if ($ownerProcess) {
        if ($ownerProcess.CommandLine.Contains($batchScript)) { Write-Host "报告批次已运行，PID $($owner.pid)"; return }
        throw '批次锁 PID 被其他进程占用，请核对'
    }
    $ingestFile = Join-Path $dataRoot 'state/ingest.lock'
    if (Test-Path -LiteralPath $ingestFile) {
        $ingestOwner = Get-Content -LiteralPath $ingestFile -Raw | ConvertFrom-Json
        if ($ingestOwner.pid -eq $owner.pid) {
            $children = Get-CimInstance Win32_Process -Filter "Name='bun.exe' OR Name='python.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($repoRoot) -and $_.CommandLine -match '(parse_pdf|\b(import|embed|extract|reindex)\b)' }
            if ($children) { throw '发现可能仍在运行的入库子进程，暂不清理旧锁' }
            Remove-Item -LiteralPath $ingestFile
        }
    }
    Remove-Item -LiteralPath $workerFile
}
if (Test-Path -LiteralPath (Join-Path $batchDir 'pause')) { throw '批次已请求暂停；确认继续后删除 _batch/pause 再启动' }
node scripts/patch-gbrain.mjs
if ($LASTEXITCODE -ne 0) { throw 'GBrain 兼容检查失败' }
$workerArgs = @(('"' + $batchScript + '"'), '--source', ('"' + $Source + '"'), '--output', ('"' + $Output + '"'), '--year', [string]$Year, '--from-month', [string]$FromMonth, '--to-month', [string]$ToMonth, '--batch-size', [string]$BatchSize)
if ($RetryFailed) { $workerArgs += '--retry-failed' }
if ($ParseOnly) { $workerArgs += '--parse-only' }
$workerArgs += @('--concurrency', [string]$Concurrency)
$worker = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $workerArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $batchDir 'worker.stdout.log') -RedirectStandardError (Join-Path $batchDir 'worker.stderr.log') -PassThru
@{pid=$worker.Id;source=$Source;output=$Output;mode=$(if ($ParseOnly) { 'parse_only' } else { 'index' });concurrency=$Concurrency;started_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $batchDir 'worker.json') -Encoding utf8
$started = $false
for ($attempt=0; $attempt -lt 20; $attempt++) {
    $worker.Refresh()
    if ($worker.HasExited) { throw "批次进程已退出，请检查 $batchDir\worker.stderr.log" }
    if (Test-Path -LiteralPath $workerFile) {
        $running = Get-Content -LiteralPath $workerFile -Raw | ConvertFrom-Json
        if ($running.pid -eq $worker.Id) { $started = $true; break }
    }
    Start-Sleep -Milliseconds 500
}
if (-not $started) { throw '批次尚未获得运行锁，请检查后台日志' }
Write-Host "报告批次已启动，PID $($worker.Id)；进度：$(Join-Path $batchDir 'status.json')"
