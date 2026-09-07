$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\deployment.ps1"
Set-Location $repoRoot
& "$PSScriptRoot\setup.ps1"
$gbrainCommit = '8c70f6255047a7647adb30b1d6333a48068d9fa5'
if (-not (Test-Path vendor\gbrain\.git)) {
    git clone https://github.com/garrytan/gbrain.git vendor/gbrain
    if ($LASTEXITCODE -ne 0) { throw 'GBrain 下载失败' }
    git -C vendor/gbrain checkout $gbrainCommit
    if ($LASTEXITCODE -ne 0) { throw 'GBrain 版本切换失败' }
}
if ((git -C vendor/gbrain rev-parse HEAD) -ne $gbrainCommit) { throw 'GBrain 源码版本与验收版本不一致，请先检查本地修改。' }
npm ci --cache ./work/npm-cache
if ($LASTEXITCODE -ne 0) { throw 'Node 依赖安装失败' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
& .\node_modules\bun\bin\bun.exe install --cwd vendor/gbrain --frozen-lockfile --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'GBrain 依赖安装失败' }
$mineruPython = Join-Path $dataRoot 'runtime/mineru/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $mineruPython)) {
    uv venv (Join-Path $dataRoot 'runtime/mineru') --python 3.12
    if ($LASTEXITCODE -ne 0) { throw 'Python 环境创建失败' }
}
$requirements = if ($wikiConfig.mineruDevice -eq 'cuda') { 'requirements-mineru.txt' } else { 'requirements-mineru-cpu.txt' }
$torchIndex = if ($wikiConfig.mineruDevice -eq 'cuda') { 'https://download.pytorch.org/whl/cu128' } else { 'https://download.pytorch.org/whl/cpu' }
uv pip install --python $mineruPython -r $requirements --extra-index-url $torchIndex --index-strategy unsafe-best-match
if ($LASTEXITCODE -ne 0) { throw 'MinerU 安装失败' }
& (Join-Path $dataRoot 'runtime/mineru/Scripts/mineru-models-download.exe') --source $wikiConfig.mineruModelSource --model_type pipeline
if ($LASTEXITCODE -ne 0) { throw 'MinerU 模型下载失败' }
docker compose @composeArgs up -d --wait
if ($LASTEXITCODE -ne 0) { throw '容器启动失败' }
$model = $wikiConfig.embeddingModel -replace '^ollama:', ''
Invoke-RestMethod "$($wikiConfig.ollamaUrl)/api/pull" -Method Post -ContentType application/json -Body (@{model=$model;stream=$false} | ConvertTo-Json) -TimeoutSec 3600 | Out-Null
node scripts/init-brain.mjs
if ($LASTEXITCODE -ne 0) { throw 'GBrain 初始化失败' }
node scripts/seed-wiki.mjs
if ($LASTEXITCODE -ne 0) { throw 'Wiki 导航初始化失败' }
node scripts/setup-mcp.mjs
if ($LASTEXITCODE -ne 0) { throw 'MCP 配置失败' }
node scripts/wiki.mjs index
if ($LASTEXITCODE -ne 0) { throw 'Wiki 初始索引失败' }
& "$PSScriptRoot\start.ps1"
