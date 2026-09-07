import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { usePage } from '../api/hooks';
import { editUrl, graphUrl, pageUrl } from '../api/client';
import { useUi, useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock } from '../app/ui';
import { Markdown } from '../reader/Markdown';
import { ReaderAside } from '../reader/ReaderAside';
import { ArticleMetadata } from '../reader/ArticleMetadata';
import { ResearchMetadata } from '../reader/ResearchMetadata';
import { splitPdfPages, pdfPageId, sectionPrefix } from '../lib/outline';
import { typeColor, typeLabel, STATUS_LABELS } from '../lib/types';
import { relativeTime, formatDate } from '../lib/format';
import type { Page } from '../api/types';

function findTextNode(root: HTMLElement, needle: string): Node | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const candidates = [needle, needle.slice(0, 40), needle.slice(0, 24)].filter(s => s.length >= 8);
  for (const candidate of candidates) {
    walker.currentNode = root;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.replace(/\s+/g, ' ').includes(candidate)) return node;
    }
  }
  return null;
}

/** Scroll to `?find=` text or `#hash` targets once the article is in the DOM. */
function useScrollTargets(page: Page | undefined, bodyRef: React.RefObject<HTMLDivElement | null>) {
  const [params] = useSearchParams();
  const location = useLocation();
  const find = params.get('find');
  useEffect(() => {
    if (!page || !bodyRef.current) return;
    const root = bodyRef.current;
    let target: Element | null = null;
    const locate = () => {
      if (find) {
        const node = findTextNode(root, find.replace(/\s+/g, ' '));
        if (node?.parentElement) {
          target = node.parentElement.closest('p, li, td, h1, h2, h3, h4, blockquote, pre') ?? node.parentElement;
          target.classList.add('flash');
        }
      }
      if (!target && location.hash) {
        target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      }
    };
    const scroll = () => {
      if (target) target.scrollIntoView({ block: find ? 'center' : 'start' });
      else document.getElementById('content-scroll')?.scrollTo({ top: 0 });
    };
    // Lazily rendered PDF sections change height once they enter the viewport,
    // so the scroll is applied again after layout settles.
    const first = window.setTimeout(() => { locate(); scroll(); }, 50);
    const second = window.setTimeout(scroll, 450);
    const third = window.setTimeout(scroll, 1200);
    return () => { window.clearTimeout(first); window.clearTimeout(second); window.clearTimeout(third); };
  }, [page, find, location.hash, bodyRef]);
}

export function PageView() {
  const params = useParams();
  const slug = params['*'] ?? '';
  const navigate = useNavigate();
  const { toast, openNewPage } = useUi();
  const { data: page, isLoading, error } = usePage(slug);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (page && page.slug !== slug) navigate(pageUrl(page.slug), { replace: true });
  }, [page, slug, navigate]);

  useCrumbs(page ? [{ label: typeLabel(page.type), to: `/library?type=${page.type}` }, { label: page.title }] : [{ label: slug }]);
  useScrollTargets(page, bodyRef);

  const readerMarkdown = useMemo(() => page?.type === 'source'
    ? page.markdown.replace(/^> 文献全文。接收时间：[^\n]*(?:\n|$)/m, '')
    : (page?.markdown ?? ''), [page]);
  const sections = useMemo(() => (page && page.pdf_pages > 0 ? splitPdfPages(readerMarkdown) : null), [page, readerMarkdown]);

  // Scroll spy for the outline.
  useEffect(() => {
    const scroller = document.getElementById('content-scroll');
    if (!scroller || !page) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const root = bodyRef.current;
        if (!root) return;
        const headings = root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], section.pdf-page[id]');
        const top = scroller.getBoundingClientRect().top + 24;
        let current: string | null = null;
        for (const h of headings) {
          if (h.getBoundingClientRect().top <= top) current = h.id;
          else break;
        }
        setActiveId(current);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { scroller.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [page]);

  if (isLoading) return <div className="content-inner"><Loading /></div>;
  if (error || !page) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <div className="content-inner">
        {status === 404 ? (
          <div className="empty">
            <h3>页面不存在</h3>
            <p className="mono small">{slug}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => openNewPage()}>新建页面</button>
              <Link className="btn ghost" to="/library">打开资料库</Link>
            </div>
          </div>
        ) : <ErrorBlock error={error ?? '无法加载'} title="页面加载失败" />}
      </div>
    );
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/page/${slug}`);
      toast('链接已复制');
    } catch { toast('复制失败', 'error'); }
  };

  const status = page.review_status ? (STATUS_LABELS[page.review_status] ?? page.review_status) : null;

  return (
    <div className={`reader ${page.type === 'source' ? 'reader-three-col' : ''}`}>
      <article>
        <header>
          <div className="eyebrow">
            <b style={{ color: typeColor(page.type) }}>{typeLabel(page.type)}</b>
            {status && <span className="flag">{status}</span>}
            {!page.indexed && <span className="flag" title="此页面尚未进入检索索引">未索引</span>}
            {page.indexed && page.stale && <span className="flag" title="磁盘文件比索引新">索引待更新</span>}
          </div>
          <h1 className="page-title">{page.title}</h1>
          <div className="meta-line">
            <span><code>{page.slug}</code></span>
            <span>更新于 {relativeTime(page.updated_at)}</span>
            {page.provenance?.received_at && <span>接收 {formatDate(page.provenance.received_at)}</span>}
            {page.provenance?.published_at && <span>发布日期 {formatDate(page.provenance.published_at)}</span>}
            {page.tags.length > 0 && (
              <span className="row wrap" style={{ gap: 6 }} aria-label="标签">
                {page.tags.map(tag => <Link key={tag} className="chip chip-button" to={`/library?tag=${encodeURIComponent(tag)}`}>{tag}</Link>)}
              </span>
            )}
          </div>
          <div className="actions">
            {page.provenance?.raw_url && <a className="btn" href={page.provenance.raw_url} target="_blank" rel="noopener noreferrer">原文件附件</a>}
            {page.editable
              ? <Link className={`btn ${page.provenance?.raw_url ? '' : 'primary'}`} to={editUrl(page.slug)}>编辑</Link>
              : <button className="btn" disabled title={page.edit_reason ?? ''}>只读</button>}
            <Link className="btn" to={graphUrl(page.slug)}>关联图</Link>
            {page.provenance?.parsed_url && <a className="btn" href={page.provenance.parsed_url}>解析 Markdown</a>}
            {page.type === 'source' && <button className="btn" onClick={() => openNewPage('claim', page.slug)}>由此新建观点</button>}
            {page.type === 'source' && <button className="btn" onClick={() => openNewPage('note', page.slug)}>添加阅读笔记</button>}
            <button className="btn ghost" onClick={copyLink}>复制链接</button>
          </div>
        </header>

        {page.research && <ResearchMetadata fields={page.research} />}
        {page.frontmatter_error && <div className="notice warn frontmatter-error">frontmatter 解析失败：{page.frontmatter_error}</div>}
        {page.type === 'source' && page.relations.in.derived_from?.some(ref => ['note', 'paper', 'report'].includes(ref.type)) && (
          <section className="notice" style={{ marginBottom: 20 }}>
            <b>阅读笔记与解读</b>
            <ul>{page.relations.in.derived_from.filter(ref => ['note', 'paper', 'report'].includes(ref.type)).map(ref => (
              <li key={ref.slug}><Link to={pageUrl(ref.slug)}>{ref.title}</Link></li>
            ))}</ul>
          </section>
        )}

        <div ref={bodyRef} className="reader-body">
          {sections ? (
            sections.map(section => section.page === null ? (
              <div key="preamble" className="md-preamble"><Markdown markdown={section.markdown} /></div>
            ) : (
              <section key={section.page} id={pdfPageId(section.page)} className="pdf-page">
                <Markdown markdown={section.markdown} idPrefix={sectionPrefix(section.page)} />
              </section>
            ))
          ) : (
            <Markdown markdown={readerMarkdown} />
          )}
        </div>
      </article>

      <ReaderAside page={page} sections={sections} activeId={activeId} onNavigate={id => navigate(`#${id}`)} />
      {page.type === 'source' && <aside className="reader-info" aria-label="文献与研究信息"><ArticleMetadata key={page.slug} fields={page.frontmatter} /></aside>}
    </div>
  );
}
