import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function createShareGuide({ baseUrl, token, outputDir, downloadBaseUrl }) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址无效');
  if (!token?.trim()) throw new Error('没有可分发的只读凭据');
  baseUrl = url.href.replace(/\/$/, '');
  const files = {};
  for (const file of ['scripts/agent/client.mjs', 'scripts/agent/cli.mjs', 'scripts/agent/tools.mjs', 'scripts/query/contract.mjs', 'scripts/server/errors.mjs', 'config/query-fields.json']) {
    files['client/' + file] = await fs.readFile(path.join(repo, file), 'utf8');
  }
  const original = await fs.readFile(path.join(repo, 'skills/researchwiki/SKILL.md'), 'utf8');
  files['SKILL.md'] = original.replace(/优先使用已连接的[\s\S]*?(?=- 初次访问)/,
    '使用本 Skill 自带的查询入口：`node "__RESEARCHWIKI_SKILL_DIR__/scripts/research.mjs" <操作> [参数]`。它自动读取同目录 connection.json 中的远程地址和只读凭据，无需设置环境变量或安装项目依赖。可以从任何工作目录调用。优先复用已配置好的 research_* MCP 工具；未连接 MCP 时直接用此 CLI。CLI help 返回工具 schema，stdout 是 JSON。安装和网络说明见 [接入说明](references/agent-access.md)。\n\n')
    .replaceAll('node scripts/agent/cli.mjs', 'node "__RESEARCHWIKI_SKILL_DIR__/scripts/research.mjs"')
    .replace('并给出 `npm run research:index` 的维护命令', '并通知知识库维护者重建索引');
  files['references/agent-access.md'] = await fs.readFile(path.join(repo, 'docs/agent-access.md'), 'utf8');
  files['references/agent-access-migration.md'] = await fs.readFile(path.join(repo, 'docs/agent-access-migration.md'), 'utf8');
  files['scripts/research.mjs'] = `import fs from 'node:fs/promises';
const connection = JSON.parse(await fs.readFile(new URL('../connection.json', import.meta.url), 'utf8'));
process.env.RESEARCHWIKI_URL = connection.base_url;
process.env.RESEARCHWIKI_TOKEN = connection.token;
delete process.env.RESEARCHWIKI_TOKEN_FILE;
const { main } = await import('../client/scripts/agent/cli.mjs');
main().catch(e => { console.log(JSON.stringify({ error: e.message, code: e.code ?? 'CLIENT_ERROR' })); process.exitCode = 1; });
`;
  const payload = gzipSync(JSON.stringify({ files, connection: { base_url: baseUrl, token: token.trim() } })).toString('base64');
  const template = await fs.readFile(path.join(repo, 'scripts/agent/install-skill.template.mjs'), 'utf8');
  const installer = template.replace('__RESEARCHWIKI_PAYLOAD__', payload);
  const fence = '```';
  const guide = `# ResearchWiki 研究知识库 Skill：一键安装

这份文档可直接交给接收方的 AI Agent。内含安装脚本和当前有效的共享只读 token；持有人可读取整个知识库，请仅转发给获授权的使用者。
${downloadBaseUrl ? `
在线安装文档：[打开本文](${downloadBaseUrl}/researchwiki-install.md)。自包含脚本：[下载 researchwiki-install.mjs](${downloadBaseUrl}/researchwiki-install.mjs)。两者通过分享链接直接下载，无需额外 Bearer；请把分享链接视为只读访问凭据。

Agent 可直接下载脚本，先阅读，再运行 \`node researchwiki-install.mjs\`（自定义技能位置使用 \`--target\`）。下载响应应为 HTTP 200，不能把网络错误响应保存为安装脚本后执行。
` : ''}

## 最省事的用法

把本文件发给你的 Agent，并说：

> 请按照这份文档安装 ResearchWiki Skill。提取文末 JavaScript 代码块，原样保存为 researchwiki-install.mjs，然后运行 node researchwiki-install.mjs。默认安装到 Codex 技能目录；如果你使用其他 Agent，请用 --target 指向该 Agent 的 researchwiki 技能目录。安装后调用 describe 验证连接，再用 describe "半导体" --section tags 查询真实标签。不要在回复中展示 token。

安装只要求 **Node.js 22+**，不需要 npm install、Git 仓库、数据库、模型或本地知识库。脚本包含所需客户端和 Skill，自动保存连接设置并执行联网验证。

## 网络前提

服务地址为 **${baseUrl}**。这是 Tailscale 内网地址，接收方机器必须已获准通过 Tailscale/路由访问该机器的 8020 端口。仅拿到 token 并不会自动获得网络权限；安装脚本不更改 Tailscale 登录或防火墙。

## 已配置的连接信息

- HTTP 查询：${baseUrl}/api/research/<describe|resolve|query|search|read|related>
- MCP：${baseUrl}/mcp（Streamable HTTP）
- 鉴权：Authorization 请求头，内容为 Bearer 加一个空格，再加下面的完整 token。

${fence}text
${token.trim()}
${fence}

安装脚本已内嵌相同凭据，无需手工填写。token 是共享只读凭据，不具备写入权限，也不是逐用户独立账户；维护者更换后，旧文档中的 token 会失效。

## 手工安装：执行一次命令

将文末唯一的 JavaScript 代码块保存为 UTF-8 文件 researchwiki-install.mjs（不要保存 Markdown 围栏），在文件所在目录执行：

${fence}sh
node researchwiki-install.mjs
${fence}

Windows、macOS 和 Linux 使用相同脚本。默认路径为当前用户的 ~/.codex/skills/researchwiki；若设置了 CODEX_HOME，则使用其 skills/researchwiki 目录。其他 Agent 支持 SKILL.md 时，可将目录改为它实际发现技能的位置：

${fence}sh
node researchwiki-install.mjs --target "/你的Agent技能目录/researchwiki"
${fence}

脚本只更新自己曾安装的目录，遇到同名但非本安装器管理的技能会停止，不覆盖现有内容。凭据写入技能目录的 connection.json，后续调用自动读取，无需每次粘贴 token。刷新客户端技能列表或新开会话后生效；如果客户端未自动发现，显式加载安装目录中的 SKILL.md。

## 验证与使用

安装完成会输出查询入口的绝对路径，并显示“连接验证通过”。把该路径替换到下面的命令即可从任意工作目录调用：

${fence}sh
node "<安装目录>/scripts/research.mjs" describe
node "<安装目录>/scripts/research.mjs" describe "半导体" --section tags
node "<安装目录>/scripts/research.mjs" query --tag "从词典中确认的完整标签" --limit 10
node "<安装目录>/scripts/research.mjs" search "资本开支" --mode lexical
${fence}

也可以直接对 Agent 说：“使用 ResearchWiki，找最近关于 DRAM 的报告，先确认领域标签，再查找材料，引用前读取原文并提供页码。”

- 查询与正文检索都支持标签交集、并集和排除，公司代码保留前导零。
- 引用前读取文档的明确 revision_id 和 block_id；不要把搜索摘要当成已核验原文。
- 401：凭据无效，请向维护者索取新版安装文档；429：按 Retry-After 稍后重试；连接超时或 SERVICE_UNAVAILABLE：先核查内网可达性和服务状态。
- 网络检查失败时安装文件仍保留，修好网络后重新运行输出的 describe 命令即可。安装成功不表示可绕过网络 ACL。
- 本次 Skill 通过 CLI 即可完整查询，不会修改全局 MCP 配置。已有远程 MCP 客户端可另行使用上面的 URL 和 Bearer header；不支持静态 Bearer 的连接器不适用此 MCP 配置。

## 自包含安装脚本

以下代码块已包含全部安装内容；只转发这一份 Markdown 即可，无需附加压缩包或项目文件。

${fence}javascript
${installer.trim()}
${fence}
`;
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const document = path.join(outputDir, 'ResearchWiki-一键安装.md');
  const script = path.join(outputDir, 'researchwiki-install.mjs');
  await fs.writeFile(document, guide, { mode: 0o600 });
  await fs.writeFile(script, installer, { mode: 0o600 });
  return { document, script, bytes: Buffer.byteLength(guide) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { config, dataPath } = await import('../common.mjs');
  const baseUrl = process.argv[2] || config.agent?.publicBaseUrl;
  if (!baseUrl) throw new Error('请指定已验证的远程地址：node scripts/agent/create-share-guide.mjs http://服务器:8020');
  const token = await fs.readFile(dataPath('runtime', 'mcp-read-token'), 'utf8');
  console.log(JSON.stringify(await createShareGuide({ baseUrl, token, outputDir: path.join(repo, 'outputs/private') })));
}
