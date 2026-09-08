import { useStats, useStatus } from '../api/hooks';
import { useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeBadge } from '../app/ui';
import { formatNumber, formatDateTime } from '../lib/format';
import { RELATION_LABELS } from '../lib/types';

function Service({ name, ok, detail }: { name: string; ok: boolean; detail?: string | null }) {
  return (
    <div className="stat">
      <div className="label">{name}</div>
      <div className="value" style={{ color: ok ? 'var(--ok)' : 'var(--danger)', fontSize: 16 }}>{ok ? '正常' : '异常'}</div>
      {detail && <div className="sub">{detail}</div>}
    </div>
  );
}

export function StatusPage() {
  useCrumbs([{ label: '状态' }]);
  const { data: status } = useStatus();
  const { data: stats, isLoading, error } = useStats();

  if (isLoading) return <div className="content-inner"><Loading /></div>;
  if (error || !stats) return <div className="content-inner"><ErrorBlock error={error ?? '无法加载'} title="状态加载失败" /></div>;

  const db = stats.database;
  const drift = db ? stats.files - db.pages : null;

  return (
    <div className="content-inner">
      <h1 style={{ fontSize: 'var(--fs-xl)', marginBottom: 16 }}>系统状态</h1>

      <h2 className="section-title">服务</h2>
      <div className="stat-grid">
        <Service name="PostgreSQL + pgvector" ok={stats.services.postgres.ok} detail={stats.services.postgres.error ?? '127.0.0.1:5436'} />
        <Service name="GBrain MCP" ok={stats.services.mcp.ok} detail={stats.services.mcp.version ? `v${stats.services.mcp.version} · :3131` : ':3131'} />
        <Service name={stats.services.ollama.provider === 'shared' ? '内网 GPU embedding' : 'Ollama embedding'} ok={stats.services.ollama.ok && stats.services.ollama.model_present !== false} detail={stats.services.ollama.error ?? (stats.services.ollama.ok ? `${stats.model} · ${stats.services.ollama.model_present ? '可用' : '模型不可用'}` : '服务不可用')} />
      </div>

      <h2 className="section-title">索引</h2>
      <div className="stat-grid">
        <div className="stat"><div className="label">磁盘页面</div><div className="value">{stats.files}</div></div>
        <div className="stat"><div className="label">已索引页面</div><div className="value">{db ? db.pages : '—'}</div><div className="sub">{drift ? `与磁盘相差 ${drift}` : '与磁盘一致'}</div></div>
        <div className="stat"><div className="label">向量块</div><div className="value">{db ? `${db.chunks.embedded}/${db.chunks.total}` : '—'}</div><div className="sub">{db?.dims.length ? `${db.dims.join('/')} 维` : ''}</div></div>
        <div className="stat"><div className="label">标签</div><div className="value">{db ? db.tags : '—'}</div></div>
        <div className="stat"><div className="label">上次索引</div><div className="value" style={{ fontSize: 14 }}>{formatDateTime(status?.last_index_at)}</div><div className="sub">{status?.active ? `正在处理：${status.active.label}` : status?.queue ? `${status.queue} 项排队` : '空闲'}</div></div>
      </div>
      {stats.database_error && <div className="error-block" style={{ marginBottom: 16 }}>数据库不可用：{stats.database_error}</div>}

      {db && (
        <div className="two-col">
          <section>
            <h2 className="section-title">页面类型</h2>
            <table className="table">
              <tbody>
                {db.by_type.map(row => <tr key={row.type}><td><TypeBadge type={row.type} /></td><td className="num">{row.n}</td></tr>)}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="section-title">链接</h2>
            <table className="table">
              <tbody>
                {db.links.map(row => <tr key={row.link_type}><td>{RELATION_LABELS[row.link_type] ?? row.link_type} <span className="mono faint">{row.link_type}</span></td><td className="num">{row.n}</td></tr>)}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <h2 className="section-title">导入文档 <span className="sub">{stats.documents.length} 份</span></h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>标题</th><th>来源</th><th>状态</th><th>解析器</th><th style={{ textAlign: 'right' }}>页数</th><th style={{ textAlign: 'right' }}>字符</th></tr></thead>
          <tbody>
            {stats.documents.map(doc => (
              <tr key={doc.title + doc.wiki_slug} style={{ cursor: 'default' }}>
                <td>{doc.title}{doc.error && <div className="small" style={{ color: 'var(--danger)' }}>{doc.error}</div>}</td>
                <td>{doc.source_kind}</td>
                <td><span className={`chip ${doc.status === 'indexed' ? 'ok' : doc.status === 'failed' ? 'danger' : 'warn'}`}>{doc.status}</span></td>
                <td>{doc.parser ?? '—'}</td>
                <td className="num">{doc.pages ?? '—'}</td>
                <td className="num">{formatNumber(doc.characters)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="faint small" style={{ marginTop: 24 }}>数据目录：<span className="mono">{status?.dataRoot}</span> · 模型：<span className="mono">{stats.model}</span></p>
    </div>
  );
}
