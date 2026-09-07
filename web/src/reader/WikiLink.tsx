import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useIndex } from '../api/hooks';
import { HoverPreview } from './HoverPreview';

interface Props {
  slug: string;
  href: string;
  children?: ReactNode;
}

/** Internal wiki link: dashed when the target page does not exist, hover preview after a short delay. */
export function WikiLink({ slug, href, children }: Props) {
  const { data: index } = useIndex();
  const exists = useMemo(() => (index ? index.some(item => item.slug === slug) : true), [index, slug]);
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const timer = useRef<number | null>(null);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const onEnter = () => {
    if (!exists) return;
    timer.current = window.setTimeout(() => {
      if (ref.current) setPreview(ref.current.getBoundingClientRect());
    }, 300);
  };
  const onLeave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPreview(null);
  };

  return (
    <>
      <Link ref={ref} to={href} className={`wikilink ${exists ? '' : 'missing'}`} title={exists ? slug : `页面不存在：${slug}`} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onLeave}>
        {children}
      </Link>
      {preview && <HoverPreview slug={slug} anchor={preview} />}
    </>
  );
}
