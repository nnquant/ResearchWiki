import fs from 'node:fs/promises';
import { splitFrontmatter } from './wiki-files.mjs';

/** Read only the YAML header, in bounded chunks. Large article bodies stay off this path. */
export async function readGraphHeader(file) {
  const handle = await fs.open(file, 'r');
  try {
    const chunks = [];
    let size = 0;
    while (size < 1024 * 1024) {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      chunks.push(buffer.subarray(0, bytesRead)); size += bytesRead;
      const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
      if (!/^---\r?\n/.test(text)) return { frontmatter: {}, title: text.match(/^# (.+)$/m)?.[1] };
      const end = /\r?\n---(?:\r?\n|$)/g;
      end.lastIndex = text.indexOf('\n');
      const match = end.exec(text);
      if (match) {
        const { frontmatter, error } = splitFrontmatter(text.slice(0, match.index + match[0].length));
        if (error) throw new Error('材料 YAML 元数据格式无效');
        return { frontmatter };
      }
      if (bytesRead < buffer.length) throw new Error('材料 YAML 元数据缺少结束标记');
    }
    throw new Error('材料 YAML 元数据超过 1 MiB');
  } finally { await handle.close(); }
}

