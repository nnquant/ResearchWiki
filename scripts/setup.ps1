$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$dataRoot = 'D:\data\gbrain'
foreach ($folder in @('raw','parsed','wiki','inbox','state','logs','backups','models','models\huggingface','models\modelscope','cache','runtime','runtime\.gbrain','postgres')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot $folder) | Out-Null
}
$envFile = Join-Path $dataRoot 'runtime\compose.env'
if (-not (Test-Path $envFile)) {
    $dbPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    [IO.File]::WriteAllText($envFile, "GBRAIN_PG_PASSWORD=$dbPassword`n", [Text.UTF8Encoding]::new($false))
}
Write-Host "数据目录已就绪：$dataRoot"
