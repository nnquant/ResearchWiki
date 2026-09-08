param([string]$Output = 'D:\data\reports\processed')
$ErrorActionPreference = 'Stop'
$outputRoot = [IO.Path]::GetFullPath($Output).TrimEnd('\','/')
$batchDir = Join-Path $outputRoot '_batch'
$planFile = Join-Path $batchDir 'plan.json'
$eventsFile = Join-Path $batchDir 'events.jsonl'
$migrationFile = Join-Path $batchDir 'layout-date-migration.json'
function Assert-InOutput([string]$Value) {
    $absolute = [IO.Path]::GetFullPath($Value)
    if (-not $absolute.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "路径越界：$absolute" }
    return $absolute
}
function Save-Json([string]$File, $Value) {
    $temp = $File + '.migration.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $File -Force
}
if (Test-Path -LiteralPath (Join-Path $batchDir 'worker.lock')) { throw '请先暂停批次并等待当前组退出' }
$workerFile = Join-Path $batchDir 'worker.json'
if (Test-Path -LiteralPath $workerFile) {
    $worker = Get-Content -LiteralPath $workerFile -Raw | ConvertFrom-Json
    if (Get-CimInstance Win32_Process -Filter "ProcessId=$($worker.pid)" -ErrorAction SilentlyContinue) { throw '旧批次进程仍在运行' }
}
$plan = Get-Content -LiteralPath $planFile -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($plan.output).TrimEnd('\','/') -ne $outputRoot) { throw '计划输出目录不匹配' }
if ($plan.output_layout -eq 'report-date') {
    $priorMigration = if (Test-Path -LiteralPath $migrationFile) { Get-Content -LiteralPath $migrationFile -Raw | ConvertFrom-Json } else { $null }
    if ($priorMigration -and $priorMigration.status -ne 'completed') {
        $plan = Get-Content -LiteralPath (Join-Path $priorMigration.backup 'plan.json') -Raw | ConvertFrom-Json
    } else { Write-Host '输出已采用日期目录'; return }
}
$lockFile = Join-Path $batchDir 'layout.lock'
$layoutLock = [IO.File]::Open($lockFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    $moves = foreach ($item in $plan.files) {
        if ($item.date -notmatch '^\d{4}-\d{2}-\d{2}$') { throw '计划包含无效日期' }
        $oldRelative = $item.output_relative.Replace('/', '\')
        $newRelative = $item.date + '/' + [IO.Path]::GetFileName($oldRelative)
        $from = Assert-InOutput (Join-Path $outputRoot $oldRelative)
        $to = Assert-InOutput (Join-Path $outputRoot $newRelative)
        [pscustomobject]@{ id=$item.id; relative=$item.relative; from=$from; to=$to; new_relative=$newRelative; old_top=$oldRelative.Split('\')[0] }
    }
    # Validate every destination before moving anything. Never merge or overwrite directories.
    foreach ($move in $moves) {
        $hasFrom = Test-Path -LiteralPath $move.from
        $hasTo = Test-Path -LiteralPath $move.to
        if ($hasFrom -and $hasTo) { throw "新旧目录同时存在，拒绝覆盖：$($move.to)" }
        foreach ($candidate in @($move.from, $move.to)) {
            if (-not (Test-Path -LiteralPath $candidate)) { continue }
            $entry = Get-Item -LiteralPath $candidate
            if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "目录类型异常：$candidate" }
            $reportFile = Join-Path $candidate 'report.json'
            if (Test-Path -LiteralPath $reportFile) {
                $report = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
                if ($report.source_relative -ne $move.relative) { throw "原件来源不匹配：$candidate" }
            } elseif ($candidate -eq $move.to) { throw "已有目标缺少来源记录：$candidate" }
        }
    }
    if (-not (Test-Path -LiteralPath $migrationFile)) {
        $backup = Join-Path $batchDir ('layout-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $backup | Out-Null
        Copy-Item -LiteralPath $planFile -Destination (Join-Path $backup 'plan.json')
        Copy-Item -LiteralPath $eventsFile -Destination (Join-Path $backup 'events.jsonl')
        Save-Json $migrationFile @{status='started';backup=$backup;started_at=[DateTime]::UtcNow.ToString('o')}
    }
    $moved = 0
    foreach ($move in $moves) {
        if (-not (Test-Path -LiteralPath $move.from)) { continue }
        $from = Assert-InOutput $move.from
        $to = Assert-InOutput $move.to
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($to)) | Out-Null
        Move-Item -LiteralPath $from -Destination $to
        $moved++
    }
    $states = @{}
    foreach ($line in [IO.File]::ReadLines($eventsFile)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $event = $line | ConvertFrom-Json
        $states[$event.id] = $event
    }
    $corrections = [Collections.Generic.List[string]]::new()
    foreach ($move in $moves) {
        $state = $states[$move.id]
        if ($state -and $state.output -and $state.output -ne $move.to) {
            $state.output = $move.to
            $state.updated_at = [DateTime]::UtcNow.ToString('o')
            $corrections.Add(($state | ConvertTo-Json -Depth 30 -Compress))
        }
    }
    if ($corrections.Count) { [IO.File]::AppendAllText($eventsFile, ($corrections -join "`n") + "`n", [Text.UTF8Encoding]::new($false)) }
    $byId = @{}; foreach ($move in $moves) { $byId[$move.id] = $move }
    foreach ($item in $plan.files) { $item.output_relative = $byId[$item.id].new_relative }
    $plan.version = 2
    $plan | Add-Member -NotePropertyName output_layout -NotePropertyValue 'report-date' -Force
    Save-Json $planFile $plan
    # Remove only empty old directories, deepest first; never recursively delete files.
    foreach ($top in ($moves.old_top | Select-Object -Unique)) {
        if ($top -notmatch '^\d{4}年\d{1,2}月') { continue }
        $oldRoot = Assert-InOutput (Join-Path $outputRoot $top)
        if (-not (Test-Path -LiteralPath $oldRoot)) { continue }
        $directories = @(Get-ChildItem -LiteralPath $oldRoot -Directory -Recurse) + @(Get-Item -LiteralPath $oldRoot)
        foreach ($directory in ($directories | Sort-Object { $_.FullName.Length } -Descending)) {
            $safe = Assert-InOutput $directory.FullName
            if (@(Get-ChildItem -LiteralPath $safe -Force).Count -eq 0) { Remove-Item -LiteralPath $safe }
        }
    }
    $migration = Get-Content -LiteralPath $migrationFile -Raw | ConvertFrom-Json
    $migration.status = 'completed'
    $migration | Add-Member -NotePropertyName completed_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $migration | Add-Member -NotePropertyName moved_directories -NotePropertyValue $moved -Force
    Save-Json $migrationFile $migration
    Write-Host "已迁移 $moved 份报告目录，更新 $($plan.files.Count) 项输出计划；布局：processed/YYYY-MM-DD/报告目录"
} finally { $layoutLock.Dispose(); Remove-Item -LiteralPath $lockFile }
