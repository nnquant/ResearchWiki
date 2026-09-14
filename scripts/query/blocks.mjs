import { createHash } from 'node:crypto';
export const hash = s => createHash('sha256').update(s).digest('hex');

/** Lossless contiguous spans, page boundaries take priority over paragraph size. */
export function makeBlocks(body, revision, maxChars = 1800) {
  const breaks = new Set([0, body.length]);
  for (const m of body.matchAll(/^## PDF 第 \d+ 页\s*$/gm)) breaks.add(m.index);
  const pages = [...breaks].sort((a, b) => a - b), blocks = [];
  let page = null, section = [];
  for (let p = 0; p < pages.length - 1; p++) {
    let start = pages[p];
    const end = pages[p + 1];
    const mark = body.slice(start, end).match(/^## PDF 第 (\d+) 页/);
    if (mark) page = Number(mark[1]);
    while (start < end) {
      let stop = Math.min(end, start + maxChars);
      if (stop < end) {
        const newline = body.lastIndexOf('\n\n', stop);
        if (newline > start + maxChars / 3) stop = newline + 2;
        else if (/[\uD800-\uDBFF]/.test(body[stop - 1])) stop--;
      }
      const value = body.slice(start, stop);
      for (const m of value.matchAll(/^(#{1,6}) (.+)\r?$/gm)) {
        if (/^PDF 第 \d+ 页/.test(m[2])) continue;
        section = section.slice(0, m[1].length - 1); section[m[1].length - 1] = m[2].trim();
      }
      const ordinal = blocks.length;
      blocks.push({ block_id: `${revision}:${ordinal}`, ordinal, start_offset: start, end_offset: stop, pdf_page: page, section: section.filter(Boolean), text: value });
      start = stop;
    }
  }
  return blocks;
}
