import { visit } from 'unist-util-visit';
import type { Root, Text, Link, PhrasingContent } from 'mdast';
import { normalizeSlug } from '../lib/slug';
import { encodeSlug } from '../api/client';

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Turn `[[slug|label]]` into link nodes carrying `data-slug` so the reader can resolve them. */
export function remarkWikilink() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      if (!value.includes('[[')) return;
      const nodes: PhrasingContent[] = [];
      let last = 0;
      for (const match of value.matchAll(WIKILINK)) {
        const start = match.index ?? 0;
        if (start > last) nodes.push({ type: 'text', value: value.slice(last, start) });
        const rawTarget = match[1].trim();
        const label = (match[2] ?? rawTarget).trim();
        const [targetPath, anchor] = rawTarget.split('#');
        const slug = normalizeSlug(targetPath);
        const link: Link = {
          type: 'link',
          url: slug ? `/page/${encodeSlug(slug)}${anchor ? `#${anchor}` : ''}` : '#',
          data: { hProperties: { className: ['wikilink'], dataSlug: slug } },
          children: [{ type: 'text', value: label }],
        };
        nodes.push(link);
        last = start + match[0].length;
      }
      if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
      (parent.children as PhrasingContent[]).splice(index, 1, ...nodes);
      return index + nodes.length;
    });
  };
}
