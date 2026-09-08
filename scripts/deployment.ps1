$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $repoRoot 'config.json'
if (-not (Test-Path -LiteralPath $configPath)) { Copy-Item -LiteralPath (Join-Path $repoRoot 'config.example.json') -Destination $configPath }
$wikiConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$dataRoot = [IO.Path]::GetFullPath($wikiConfig.dataRoot, $repoRoot)
$env:WIKI_DATA_ROOT = $dataRoot.Replace('\', '/')
$env:WIKI_PORT = [string]$wikiConfig.port
$env:WIKI_PG_PORT = if ($wikiConfig.postgresPort) { [string]$wikiConfig.postgresPort } else { '5436' }
$env:WIKI_OLLAMA_PORT = [string]([uri]$wikiConfig.ollamaUrl).Port
$env:WIKI_DEPLOYMENT_NAME = if ($wikiConfig.deploymentName) { $wikiConfig.deploymentName } else { 'investment-research-wiki' }
$env:GBRAIN_HOME = Join-Path $dataRoot 'runtime'
$env:GBRAIN_SOURCE = 'default'
$env:OLLAMA_BASE_URL = $wikiConfig.ollamaUrl.TrimEnd('/') + '/v1'
$env:WIKI_SHARED_API = if ($wikiConfig.sharedApi.enabled) { '1' } else { '0' }
if ($wikiConfig.sharedApi.enabled) {
    if (-not $env:QUANT_API_KEY) { $env:QUANT_API_KEY = [Environment]::GetEnvironmentVariable('QUANT_API_KEY', 'User') }
    if (-not $env:QUANT_API_KEY -and $wikiConfig.sharedApi.apiKeyFile) {
        $sharedKeyPath = [IO.Path]::GetFullPath($wikiConfig.sharedApi.apiKeyFile, $dataRoot)
        if (Test-Path -LiteralPath $sharedKeyPath) { $env:QUANT_API_KEY = (Get-Content -LiteralPath $sharedKeyPath -Raw).Trim() }
    }
    $sharedUrl = if ($env:QUANT_API_URL) { $env:QUANT_API_URL } else { $wikiConfig.sharedApi.baseUrl }
    $env:OLLAMA_BASE_URL = $sharedUrl.TrimEnd('/') + '/v1'
    $env:OLLAMA_API_KEY = $env:QUANT_API_KEY
    $env:GBRAIN_AI_EMBED_TIMEOUT_MS = '210000'
    $env:GBRAIN_QUERY_EMBED_TIMEOUT_MS = '210000'
}
$env:UV_CACHE_DIR = Join-Path $dataRoot 'cache/uv'
$env:BUN_INSTALL_CACHE_DIR = Join-Path $dataRoot 'cache/bun'
$env:HF_HOME = Join-Path $dataRoot 'models/huggingface'
$env:MODELSCOPE_CACHE = Join-Path $dataRoot 'models/modelscope'
$env:MINERU_TOOLS_CONFIG_JSON = Join-Path $dataRoot 'runtime/mineru.json'
$env:MINERU_MODEL_SOURCE = $wikiConfig.mineruModelSource
$composeArgs = @('-f', (Join-Path $repoRoot 'compose.yaml'))
if (-not $wikiConfig.sharedApi.enabled -and $wikiConfig.mineruDevice -eq 'cuda') { $composeArgs += @('-f', (Join-Path $repoRoot 'compose.gpu.yaml')) }
$composeArgs += @('--env-file', (Join-Path $dataRoot 'runtime/compose.env'))
