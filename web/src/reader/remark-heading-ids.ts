import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';
import type { Root, Heading } from 'mdast';

/** Assign heading ids with the same slugger the outline uses, so both agree. */
export function remarkHeadingIds({ prefix = '' }: { prefix?: string } = {}) {
  return (tree: Root) => {
    const slugger = new GithubSlugger();
    visit(tree, 'heading', (node: Heading) => {
      const text = toString(node).trim();
      if (!text) return;
      const data = (node.data ??= {}) as { hProperties?: Record<string, unknown> };
      data.hProperties = { ...(data.hProperties ?? {}), id: prefix + slugger.slug(text) };
    });
  };
}
