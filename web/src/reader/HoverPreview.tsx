import { createPortal } from 'react-dom';
import { useSummary } from '../api/hooks';
import { TypeBadge } from '../app/ui';
import { relativeTime } from '../lib/format';

interface Props {
  slug: string;
  anchor: DOMRect;
}

const WIDTH = 320;

export function HoverPreview({ slug, anchor }: Props) {
  const { data, isLoading } = useSummary(slug);
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - WIDTH - 8);
  const below = anchor.bottom + 8;
  const top = below + 160 < window.innerHeight ? below : Math.max(8, anchor.top - 168);
  return createPortal(
    <div className="hover-card" style={{ left, top }}>
      {isLoading && <span className="muted">加载中…</span>}
      {data && (
        <>
          <TypeBadge type={data.type} />
          <div className="title">{data.title}</div>
          <div className="excerpt">{data.excerpt || '（空页面）'}</div>
          <div className="faint" style={{ marginTop: 6 }}>
            {data.pdf_pages > 0 ? `${data.pdf_pages} 页 · ` : ''}更新于 {relativeTime(data.updated_at)}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
