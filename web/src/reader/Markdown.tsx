import { memo, useMemo, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { remarkWikilink } from './remark-wikilink';
import { remarkHeadingIds } from './remark-heading-ids';
import { WikiLink } from './WikiLink';
import { useUi } from '../app/UiContext';

const schema = {
  ...defaultSchema,
  clobber: [],
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'id', 'className'],
    a: [...(defaultSchema.attributes?.a ?? []), 'dataSlug', 'target', 'rel'],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/, 'math-inline', 'math-display']],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'math-inline', 'math-display']],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'math-display']],
    img: [...(defaultSchema.attributes?.img ?? []), 'loading', 'width', 'height'],
    td: [...(defaultSchema.attributes?.td ?? []), 'colSpan', 'rowSpan', 'align'],
    th: [...(defaultSchema.attributes?.th ?? []), 'colSpan', 'rowSpan', 'align'],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), 'sup', 'sub', 'u', 'mark', 'figure', 'figcaption', 'details', 'summary'],
};

const katexOptions = { throwOnError: false, strict: false as const, errorColor: 'var(--danger)' };

interface Props {
  markdown: string;
  idPrefix?: string;
}

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & { node?: unknown; children?: ReactNode };

function headingWithAnchor(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  return function HeadingComponent({ node: _node, children, id, ...rest }: HeadingProps) {
    return (
      <Tag id={id} {...rest}>
        {id && <a className="anchor" href={`#${id}`} aria-hidden="true">#</a>}
        {children}
      </Tag>
    );
  };
}

function useComponents(): Components {
  const { openImage } = useUi();
  return useMemo<Components>(() => ({
    a: ({ node: _node, href, children, className, ...rest }) => {
      const slug = (rest as Record<string, unknown>)['data-slug'];
      if (typeof slug === 'string') {
        return <WikiLink slug={slug} href={href ?? '#'}>{children}</WikiLink>;
      }
      const external = typeof href === 'string' && /^https?:\/\//.test(href);
      if (external) {
        return <a href={href} className={`${className ?? ''} external`.trim()} target="_blank" rel="noopener noreferrer">{children}</a>;
      }
      return <a href={href} className={className}>{children}</a>;
    },
    img: ({ node: _node, src, alt, ...rest }) => {
      const source = typeof src === 'string' ? src : '';
      return (
        <img src={source} alt={alt ?? ''} loading="lazy" onClick={() => openImage(source, alt ?? '')} {...(rest as object)} />
      );
    },
    h1: headingWithAnchor('h1'),
    h2: headingWithAnchor('h2'),
    h3: headingWithAnchor('h3'),
    h4: headingWithAnchor('h4'),
    h5: headingWithAnchor('h5'),
    h6: headingWithAnchor('h6'),
  }), [openImage]);
}

/** Markdown renderer with GFM, KaTeX, wikilinks and sanitized raw HTML. */
export const Markdown = memo(function Markdown({ markdown, idPrefix = '' }: Props) {
  const hasMath = /\$|\\\(|\\\[/.test(markdown);
  const [mathPlugin, setMathPlugin] = useState<typeof import('rehype-katex').default | null>(null);
  useEffect(() => {
    if (!hasMath) return;
    let active = true;
    void Promise.all([import('rehype-katex'), import('katex/dist/katex.min.css')]).then(([plugin]) => {
      if (active) setMathPlugin(() => plugin.default);
    }).catch(() => { /* Keep the original formula visible when the optional chunk fails. */ });
    return () => { active = false; };
  }, [hasMath]);
  const components = useComponents();
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath, remarkWikilink, [remarkHeadingIds, { prefix: idPrefix }] as const], [idPrefix]);
  const rehypePlugins = useMemo(() => [rehypeRaw, [rehypeSanitize, schema] as const, ...(hasMath && mathPlugin ? [[mathPlugin, katexOptions] as const] : [])], [hasMath, mathPlugin]);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins as never}
        rehypePlugins={rehypePlugins as never}
        remarkRehypeOptions={{ allowDangerousHtml: true }}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});
