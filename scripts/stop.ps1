$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\deployment.ps1"
$stateFile = Join-Path $dataRoot 'state/services.json'
if (Test-Path $stateFile) {
    $services = Get-Content $stateFile -Raw | ConvertFrom-Json -AsHashtable
    foreach ($entry in $services.GetEnumerator()) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.Value.pid)" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine.Contains($repoRoot)) {
            Stop-Process -Id $entry.Value.pid
            Write-Host "已停止 $($entry.Key)"
        }
    }
    '{}' | Set-Content $stateFile -Encoding utf8
}
Write-Host '数据库与模型容器继续运行；停止它们可使用 docker compose stop。'
