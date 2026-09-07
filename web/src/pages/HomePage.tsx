import { Link } from 'react-router';
import { useHome } from '../api/hooks';
import { pageUrl } from '../api/client';
import { useUi, useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeDot, StatusChip } from '../app/ui';
import { TYPE_ORDER, typeColor } from '../lib/types';
import { relativeTime } from '../lib/format';
import type { IndexEntry } from '../api/types';

function PageRows({ items }: { items: IndexEntry[] }) {
  return (
    <ul className="doc-list">
      {items.map(item => (
        <li key={item.slug}>
          <Link to={pageUrl(item.slug)}>
            <TypeDot type={item.type} />
            <span className="title">{item.title}</span>
            <StatusChip status={item.review_status} />
            <span className="when">{relativeTime(item.updated_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HomePage() {
  useCrumbs([]);
  const { openPalette, openNewPage } = useUi();
  const { data, isLoading, error } = useHome();

  if (isLoading) return <div className="content-inner"><Loading /></div>;
  if (error || !data) return <div className="content-inner"><ErrorBlock error={error ?? '无法加载'} title="首页加载失败" /></div>;

  const ordered = [...data.types].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const shown = ordered.filter(t => t.n > 0 || t.type === 'source');

  return (
    <div className="content-inner">
      <div className="hero">
        <button className="hero-search" onClick={() => openPalette()}>
          <span>搜索研究问题、因子、策略、论文标题…</span>


        </button>
      </div>

      {data.total === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <h3>Wiki 还是空的</h3>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn primary" to="/import">导入资料</Link>
            <button className="btn" onClick={() => openNewPage()}>新建页面</button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="section-title">按类型 <span className="sub">{data.total} 个页面</span><Link className="more" to="/library">资料库 →</Link></h2>
          <div className="type-grid">
            {shown.map(t => (
              <Link key={t.type} to={`/library?type=${t.type}`} className={`type-card ${t.n === 0 ? 'zero' : ''}`}>
                <span className="dot" style={{ background: typeColor(t.type) }} />
                <span className="label">{t.label}</span>
                <span className="n">{t.n}</span>
              </Link>
            ))}
          </div>

          {data.unindexed > 0 && (
            <div className="notice warn" style={{ marginTop: 20 }}>
              有 {data.unindexed} 个页面尚未进入检索索引或已过期。可在命令面板执行「更新检索索引」。
            </div>
          )}

          <div className="two-col" style={{ marginTop: 32 }}>
            <section>
              <h2 className="section-title">最近更新</h2>
              {data.recent.length ? <PageRows items={data.recent} /> : <p className="muted small">暂无</p>}
            </section>
            <section>
              <h2 className="section-title">待阅读</h2>
              {data.unread.length ? <PageRows items={data.unread} /> : <p className="muted small">暂无</p>}
            </section>
          </div>

          <h2 className="section-title" style={{ marginTop: 40 }}>沉淀研究结论</h2>
          <div className="row wrap">
            {['claim', 'hypothesis', 'factor', 'strategy', 'experiment'].map(type => (
              <button key={type} className="btn" onClick={() => openNewPage(type)}>
                <TypeDot type={type} /> 新建{ordered.find(t => t.type === type)?.label ?? type}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
