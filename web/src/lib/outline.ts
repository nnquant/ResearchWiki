import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';
import type { Root, Heading } from 'mdast';

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
}

export interface PdfSection {
  page: number | null;
  markdown: string;
}

const PAGE_LINE = /^## PDF 第 (\d+) 页\s*$/;

/** Split a source page's markdown at "## PDF 第 N 页" markers. The first section (page null) is the preamble. */
export function splitPdfPages(markdown: string): PdfSection[] {
  const lines = markdown.split('\n');
  const sections: PdfSection[] = [];
  let current: string[] = [];
  let page: number | null = null;
  for (const line of lines) {
    const m = line.match(PAGE_LINE);
    if (m) {
      sections.push({ page, markdown: current.join('\n') });
      current = [];
      page = Number(m[1]);
      continue;
    }
    current.push(line);
  }
  sections.push({ page, markdown: current.join('\n') });
  return sections;
}

export function pdfPageId(page: number): string {
  return `pdf-page-${page}`;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Headings with ids identical to what the reader assigns (same slugger, same prefix). */
export function parseHeadings(markdown: string, prefix = ''): OutlineItem[] {
  const tree = parser.parse(markdown) as Root;
  const slugger = new GithubSlugger();
  const out: OutlineItem[] = [];
  for (const node of tree.children) {
    if (node.type !== 'heading') continue;
    const heading = node as Heading;
    const text = toString(heading).trim();
    if (!text) continue;
    out.push({ id: prefix + slugger.slug(text), level: heading.depth, text });
  }
  return out;
}

export function sectionPrefix(page: number | null): string {
  return page === null ? '' : `p${page}-`;
}
