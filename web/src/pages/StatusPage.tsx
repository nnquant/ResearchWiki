import { useState } from 'react';
import { useStats, useStatus } from '../api/hooks';
import { useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeBadge } from '../app/ui';
import { formatNumber, formatDateTime } from '../lib/format';
import { RELATION_LABELS } from '../lib/types';

function Service({ name, ok, detail }: { name: string; ok: boolean; detail?: string | null }) {
  return (
    <div className="stat">
      <div className="label">{name}</div>
      <div className="value" style={{ color: ok ? 'var(--ok)' : 'var(--danger)', fontSize: 16, fontFamily: 'var(--font-sans)' }}>{ok ? '正常' : '异常'}</div>
      {detail && <div className="sub">{detail}</div>}
    </div>
  );
}

export function StatusPage() {
  useCrumbs([{ label: '状态' }]);
  const [offset, setOffset] = useState(0);
  const { data: status, error: statusError } = useStatus();
  const { data: stats, isLoading, isFetching, isPlaceholderData, error, refetch } = useStats(offset);

  const db = stats?.database;
  const files = stats?.files ?? status?.counts.files;
  const drift = db && files !== undefined ? files - db.pages : null;
  const health = status?.services ?? stats?.services;
  const totalPages = Math.ceil((stats?.documents_total ?? 0) / 50);

  return (
    <div className="content-inner">
      <h1 style={{ fontSize: 'var(--fs-xl)', marginBottom: 16 }}>系统状态</h1>

      <h2 className="section-title">服务</h2>
      {health ? <div className="stat-grid">
        <Service name="向量数据库" ok={health.postgres.ok} detail={health.postgres.error} />
        <Service name="Embedding" ok={health.ollama.ok && health.ollama.model_present !== false} detail={health.ollama.error ?? (health.ollama.ok ? `${status?.model ?? stats?.model} · ${health.ollama.model_present ? '可用' : '模型不可用'}` : '服务不可用')} />
      </div> : statusError ? <ErrorBlock error={statusError} title="服务状态加载失败" /> : <Loading label="检查服务状态…" />}

      {isLoading && <Loading label="正在读取索引统计，服务状态已独立加载…" />}
      {error && <div className="error-block">统计加载失败，请重试。<button className="btn sm" onClick={() => void refetch()} disabled={isFetching}>重新加载</button></div>}

      <h2 className="section-title">索引</h2>
      <div className="stat-grid">
        <div className="stat"><div className="label">磁盘页面</div><div className="value">{files ?? '—'}</div></div>
        <div className="stat"><div className="label">已索引页面</div><div className="value">{db ? db.pages : '—'}</div><div className="sub">{drift === null ? '等待统计' : drift ? `与磁盘相差 ${drift}` : '与磁盘一致'}</div></div>
        <div className="stat"><div className="label">向量块{db?.chunks.estimated ? '（估算）' : ''}</div><div className="value">{db?.chunks.total != null ? `${db.chunks.embedded}/${db.chunks.total}` : '—'}</div><div className="sub">{db?.dims.length ? `${db.dims.join('/')} 维${db.dims_sampled ? '（抽样）' : ''}` : ''}</div></div>
        <div className="stat"><div className="label">标签</div><div className="value">{db ? db.tags : '—'}</div></div>
        <div className="stat"><div className="label">上次索引</div><div className="value" style={{ fontSize: 14 }}>{formatDateTime(status?.last_index_at)}</div><div className="sub">{status?.active ? `正在处理：${status.active.label}` : status?.queue ? `${status.queue} 项排队` : '空闲'}</div></div>
      </div>
      {stats?.database_error && <div className="error-block" style={{ marginBottom: 16 }}>数据库统计暂不可用：{stats.database_error} <button className="btn sm" onClick={() => void refetch()} disabled={isFetching}>重新加载</button></div>}
      {db?.checked_at && <p className="faint small" style={{ marginBottom: 16 }}>统计时间：{formatDateTime(db.checked_at)} · 缓存最多 60 秒；向量块数量使用数据库统计估算，维度抽样最多 32 个向量。</p>}

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

      {stats && <>
      <h2 className="section-title">导入文档 <span className="sub">{stats.documents_total} 份 · 每页 50 份</span></h2>
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
      {totalPages > 1 && <div className="pager">
        <button className="btn sm" disabled={offset === 0 || isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button>
        <span>{isPlaceholderData ? '加载中…' : `第 ${Math.floor(stats.documents_offset / 50) + 1} / ${totalPages} 页`}</span>
        <button className="btn sm" disabled={offset + 50 >= stats.documents_total || isFetching} onClick={() => setOffset(offset + 50)}>下一页</button>
      </div>}
      </>}

      <p className="faint small" style={{ marginTop: 24 }}>数据目录：<span className="mono">{status?.dataRoot ?? '—'}</span> · 模型：<span className="mono">{status?.model ?? stats?.model ?? '—'}</span></p>
    </div>
  );
}
