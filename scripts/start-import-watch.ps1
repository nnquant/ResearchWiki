$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\deployment.ps1"
$importConfig = (Get-Content -LiteralPath (Join-Path $repoRoot 'config.json') -Raw | ConvertFrom-Json).directoryImport
if (-not $importConfig.enabled) { Write-Host '目录导入已暂停'; return }
$watchLock = "$dataRoot\state\directory-watch.lock"
if (Test-Path -LiteralPath $watchLock) {
    $owner = Get-Content -LiteralPath $watchLock -Raw | ConvertFrom-Json
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)" -ErrorAction SilentlyContinue
    if ($ownerProcess) {
        if ($ownerProcess.CommandLine.Contains($repoRoot) -and $ownerProcess.CommandLine.Contains('import-dir')) {
            Write-Host "目录导入已运行，PID $($owner.pid)"; return
        }
        throw '目录导入锁 PID 被其他进程使用，请人工核对'
    }
    $parsers = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $repoRoot 'scripts\parse_pdf.py')) }
    if ($parsers) { throw '发现仍在运行的 MinerU 子进程，保留锁等待核对' }
    $ingestLock = "$dataRoot\state\ingest.lock"
    if (Test-Path -LiteralPath $ingestLock) {
        $ingestOwner = Get-Content -LiteralPath $ingestLock -Raw | ConvertFrom-Json
        if ($ingestOwner.pid -eq $owner.pid) { Remove-Item -LiteralPath $ingestLock }
    }
    Remove-Item -LiteralPath $watchLock
}
$watchArgs = @(('"' + (Join-Path $repoRoot 'scripts\wiki.mjs') + '"'), 'import-dir', ('"' + $importConfig.path + '"'), '--watch')
$watchProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $watchArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput "$dataRoot\logs\directory-import.stdout.log" -RedirectStandardError "$dataRoot\logs\directory-import.stderr.log" -PassThru
Write-Host "目录持续导入已启动，PID $($watchProcess.Id)，MinerU 并行度 $($importConfig.concurrency)"
