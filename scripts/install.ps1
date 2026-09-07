$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot
if (-not (Test-Path config.json)) { Copy-Item config.example.json config.json }
& "$PSScriptRoot\setup.ps1"
$gbrainCommit = '8c70f6255047a7647adb30b1d6333a48068d9fa5'
if (-not (Test-Path vendor\gbrain\.git)) {
    git clone https://github.com/garrytan/gbrain.git vendor/gbrain
    if ($LASTEXITCODE -ne 0) { throw 'GBrain 下载失败' }
    git -C vendor/gbrain checkout $gbrainCommit
}
if ((git -C vendor/gbrain rev-parse HEAD) -ne $gbrainCommit) { throw 'GBrain 源码版本与验收版本不一致，请先检查本地修改。' }
npm ci --cache ./work/npm-cache
if ($LASTEXITCODE -ne 0) { throw 'Node 依赖安装失败' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
$env:GBRAIN_HOME='D:\data\gbrain\runtime'
$env:UV_CACHE_DIR='D:\data\gbrain\cache\uv'
$env:BUN_INSTALL_CACHE_DIR='D:\data\gbrain\cache\bun'
& .\node_modules\bun\bin\bun.exe install --cwd vendor/gbrain --frozen-lockfile --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'GBrain 依赖安装失败' }
if (-not (Test-Path D:\data\gbrain\runtime\mineru\Scripts\python.exe)) {
    uv venv D:\data\gbrain\runtime\mineru --python 3.12
    if ($LASTEXITCODE -ne 0) { throw 'Python 环境创建失败' }
}
uv pip install --python D:\data\gbrain\runtime\mineru\Scripts\python.exe -r requirements-mineru.txt --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match
if ($LASTEXITCODE -ne 0) { throw 'MinerU 安装失败' }
docker compose --env-file D:\data\gbrain\runtime\compose.env up -d
if ($LASTEXITCODE -ne 0) { throw '容器启动失败' }
Invoke-RestMethod http://127.0.0.1:11435/api/pull -Method Post -ContentType application/json -Body '{"model":"bge-m3","stream":false}' -TimeoutSec 1800 | Out-Null
node scripts/init-brain.mjs
if ($LASTEXITCODE -ne 0) { throw 'GBrain 初始化失败' }
node scripts/seed-wiki.mjs
node scripts/setup-mcp.mjs
if ($LASTEXITCODE -ne 0) { throw 'MCP 配置失败' }
& "$PSScriptRoot\start.ps1"
