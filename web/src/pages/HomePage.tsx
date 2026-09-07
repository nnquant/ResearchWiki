import { Link } from 'react-router';
import { useHome } from '../api/hooks';
import { pageUrl } from '../api/client';
import { useUi, useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, TypeDot, StatusChip } from '../app/ui';
import { TYPE_ORDER, TYPE_META, CORE_TYPES, typeColor, typeLabel } from '../lib/types';
import { relativeTime } from '../lib/format';
import type { IndexEntry } from '../api/types';

function PageRows({ items, due = false }: { items: IndexEntry[]; due?: boolean }) {
  return (
    <ul className="doc-list">
      {items.map(item => (
        <li key={item.slug}>
          <Link to={pageUrl(item.slug)}>
            <TypeDot type={item.type} />
            <span className="title">{item.title}</span>
            <StatusChip status={item.review_status} />
            <span className="when">{due ? `复核 ${item.research.next_review}` : relativeTime(item.updated_at)}</span>
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
        <p className="investment-kicker">INVESTMENT RESEARCH</p>
        <h1>从证据到判断，持续跟踪投资研究</h1>
        <p className="muted">连接公司、行业与宏观，记录预期差、反方证据和每一次判断变化。</p>
        <button className="hero-search" onClick={() => openPalette()}>
          <span>搜索公司、行业、宏观问题与研究资料…</span>


        </button>
      </div>

      <div className="research-hubs">{CORE_TYPES.map((type, i) => <section className="research-hub" key={type} style={{ borderTopColor: typeColor(type) }}>
        <span className="hub-number">0{i + 1}</span>
        <h2><Link to={`/library?type=${type}`}>{typeLabel(type)}</Link></h2>
        <p>{TYPE_META[type].description}</p>
        <div className="row"><Link className="muted small" to={`/library?type=${type}`}>{data.types.find(t => t.type === type)?.n ?? 0} 篇研究 →</Link><span className="spacer" /><button className="btn sm" onClick={() => openNewPage(type)}>新建</button></div>
      </section>)}</div>

      <section style={{ marginTop: 28 }}>
        <h2 className="section-title">待复核研究 <span className="sub">{data.due_total} 项</span><Link className="more" to="/library?due=true">查看全部 →</Link></h2>
        {data.due.length ? <PageRows items={data.due} due /> : <p className="muted small">暂无到期研究。在研究页设置「下次复核」，持续追踪数据、催化剂与判断变化。</p>}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 className="section-title">记录新的证据与判断</h2>
        <div className="row wrap">{['claim', 'event', 'valuation', 'meeting', 'theme'].map(type => <button key={type} className="btn" onClick={() => openNewPage(type)}><TypeDot type={type} />{typeLabel(type)}</button>)}<Link className="btn" to="/import">导入资料</Link></div>
      </section>

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
          <h2 className="section-title" style={{ marginTop: 32 }}>按类型 <span className="sub">{data.total} 个页面</span><Link className="more" to="/library">资料库 →</Link></h2>
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

        </>
      )}
    </div>
  );
}
