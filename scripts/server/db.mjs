import fs from 'node:fs/promises';
import postgres from 'postgres';
import { dataPath } from '../common.mjs';

const pools = new Map();

/** Lazily open a small connection pool against the gbrain database. */
function getPool(role) {
  if (!pools.has(role)) {
    const opening = fs.readFile(dataPath('runtime', '.gbrain', 'config.json'), 'utf8').then(contents => {
      const brain = JSON.parse(contents);
      return postgres(brain.database_url, { max: 4, idle_timeout: 120, connect_timeout: 5,
        connection: { application_name: `researchwiki-${role}` }, onnotice: () => {} });
    }).catch(error => { pools.delete(role); throw error; });
    pools.set(role, opening);
  }
  return pools.get(role);
}
export const getSql = () => getPool('wiki-index');
export const getReadSql = () => getPool('research-read');
export const getIndexSql = () => getPool('background-index');

export async function indexVersion() {
  const s = await getSql();
  const [row] = await s`SELECT count(*)::int AS n,max(updated_at)::text AS updated FROM pages WHERE deleted_at IS NULL`;
  return JSON.stringify(row);
}

export async function ping() {
  try {
    const s = await getSql();
    await s`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  const current = [...pools.values()]; pools.clear();
  await Promise.all(current.map(async pending => { const sql = await pending; await sql.end({ timeout: 2 }); }));
}

const tagsAgg = 'coalesce(array_agg(t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL), ARRAY[]::text[])';

/** Lightweight listing used by the command palette and wikilink autocomplete. */
export async function listIndex() {
  const s = await getSql();
  return s.unsafe(`
    WITH backlinks AS (SELECT l.to_page_id,count(*)::int AS n FROM links l
      JOIN pages origin ON origin.id=l.from_page_id WHERE origin.deleted_at IS NULL GROUP BY l.to_page_id)
    SELECT p.slug, p.title, p.type, p.updated_at, p.created_at,
           coalesce(b.n,0) AS backlinks
    FROM pages p LEFT JOIN backlinks b ON b.to_page_id=p.id
    WHERE p.deleted_at IS NULL
    ORDER BY p.updated_at DESC`);
}

const SORTS = {
  updated: 'p.updated_at',
  created: 'p.created_at',
  title: 'p.title',
  type: 'p.type',
  slug: 'p.slug',
};

/** Filterable, paginated page listing for the library table. */
export async function listPages({ type = [], tag = null, status = null, q = null, sort = 'updated', dir = 'desc', limit = 50, offset = 0 } = {}) {
  const s = await getSql();
  const where = ['p.deleted_at IS NULL'];
  const params = [];
  const add = value => { params.push(value); return `$${params.length}`; };
  if (type.length) where.push(`p.type = ANY(${add(type)}::text[])`);
  if (tag) where.push(`EXISTS (SELECT 1 FROM tags tt WHERE tt.page_id = p.id AND tt.tag = ${add(tag)})`);
  if (status) where.push(`coalesce(p.frontmatter->>'review_status', '') = ${add(status)}`);
  if (q) {
    const like = `%${q}%`;
    where.push(`(p.title ILIKE ${add(like)} OR p.slug ILIKE ${add(like)})`);
  }
  const order = `${SORTS[sort] ?? SORTS.updated} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, p.id DESC`;
  const rows = await s.unsafe(`
    SELECT p.slug, p.title, p.type, p.created_at, p.updated_at,
           p.frontmatter->>'review_status' AS review_status,
           p.frontmatter->>'source_kind' AS source_kind,
           ${tagsAgg} AS tags,
           (SELECT count(*)::int FROM links l WHERE l.to_page_id = p.id) AS backlinks,
           count(*) OVER() ::int AS total
    FROM pages p LEFT JOIN tags t ON t.page_id = p.id
    WHERE ${where.join(' AND ')}
    GROUP BY p.id
    ORDER BY ${order}
    LIMIT ${add(limit)} OFFSET ${add(offset)}`, params);
  const total = rows[0]?.total ?? 0;
  return { total, items: rows.map(({ total: _t, ...row }) => row) };
}

export async function getPageRow(slug) {
  const s = await getSql();
  const rows = await s.unsafe(`
    SELECT p.id, p.slug, p.title, p.type, p.created_at, p.updated_at, p.frontmatter,
           ${tagsAgg} AS tags
    FROM pages p LEFT JOIN tags t ON t.page_id = p.id
    WHERE p.slug = $1 AND p.deleted_at IS NULL
    GROUP BY p.id
    LIMIT 1`, [slug]);
  return rows[0] ?? null;
}

const linkColumns = 'l.link_type, l.link_source, l.context';

export async function getLinksOut(pageId) {
  const s = await getSql();
  return s.unsafe(`
    SELECT p.slug, p.title, p.type, ${linkColumns}
    FROM links l JOIN pages p ON p.id = l.to_page_id
    WHERE l.from_page_id = $1 AND p.deleted_at IS NULL
    ORDER BY l.link_type, p.title`, [pageId]);
}

export async function getBacklinks(pageId) {
  const s = await getSql();
  return s.unsafe(`
    SELECT p.slug, p.title, p.type, ${linkColumns}
    FROM links l JOIN pages p ON p.id = l.from_page_id
    WHERE l.to_page_id = $1 AND p.deleted_at IS NULL
    ORDER BY l.link_type, p.title`, [pageId]);
}

/** Manual typed links currently recorded for a page (used to drop stale relations on re-index). */
export async function getManualLinksOut(slug) {
  const s = await getSql();
  return s.unsafe(`
    SELECT p2.slug AS to_slug, l.link_type
    FROM links l JOIN pages p1 ON p1.id = l.from_page_id JOIN pages p2 ON p2.id = l.to_page_id
    WHERE p1.slug = $1 AND l.link_source = 'manual'`, [slug]);
}

/**
 * Breadth-first neighbourhood around a slug over the links table.
 * Returns { nodes, edges, truncated }.
 */
export async function getNeighborhood(slug, { depth = 1, limit = 150, linkTypes = [] } = {}) {
  const s = await getSql();
  const center = await getPageRow(slug);
  if (!center) return null;
  const ids = new Map([[center.id, 0]]);
  let frontier = [center.id];
  const edges = new Map();
  let truncated = false;
  const edgeLimit = 2000;
  for (let level = 1; level <= depth && frontier.length; level++) {
    const params = [frontier];
    let typeFilter = '';
    if (linkTypes.length) { params.push(linkTypes); typeFilter = 'AND l.link_type = ANY($2::text[])'; }
    params.push(edgeLimit + 1);
    const rows = await s.unsafe(`
      SELECT l.from_page_id, l.to_page_id, l.link_type, l.link_source, l.context
      FROM links l
      JOIN pages pf ON pf.id = l.from_page_id AND pf.deleted_at IS NULL
      JOIN pages pt ON pt.id = l.to_page_id AND pt.deleted_at IS NULL
      WHERE (l.from_page_id = ANY($1::int[]) OR l.to_page_id = ANY($1::int[])) ${typeFilter}
      ORDER BY l.from_page_id, l.to_page_id, l.link_type, l.link_source LIMIT $${params.length}`, params);
    if (rows.length > edgeLimit) truncated = true;
    const next = [];
    for (const row of rows.slice(0, edgeLimit)) {
      if (edges.size >= edgeLimit) { truncated = true; break; }
      for (const id of [row.from_page_id, row.to_page_id]) {
        if (ids.has(id)) continue;
        if (ids.size >= limit) { truncated = true; continue; }
        ids.set(id, level);
        next.push(id);
      }
      if (ids.has(row.from_page_id) && ids.has(row.to_page_id)) {
        edges.set(`${row.from_page_id}>${row.to_page_id}>${row.link_type}>${row.link_source}`, row);
      }
    }
    frontier = next;
  }
  const nodes = await s.unsafe(`
    SELECT p.id, p.slug, p.title, p.type,
           (SELECT count(*)::int FROM links l WHERE l.from_page_id = p.id OR l.to_page_id = p.id) AS degree
    FROM pages p WHERE p.id = ANY($1::int[])`, [[...ids.keys()]]);
  const bySlug = new Map(nodes.map(n => [n.id, n.slug]));
  return {
    center: center.slug,
    nodes: nodes.map(n => ({ id: n.slug, title: n.title, type: n.type, degree: n.degree, level: ids.get(n.id) })),
    edges: [...edges.values()].map(e => ({
      source: bySlug.get(e.from_page_id), target: bySlug.get(e.to_page_id), link_type: e.link_type, link_source: e.link_source, context: e.context,
    })),
    truncated,
  };
}

export async function typeCounts() {
  const s = await getSql();
  return s.unsafe(`SELECT type, count(*)::int AS n FROM pages WHERE deleted_at IS NULL GROUP BY type ORDER BY n DESC`);
}

export async function tagCounts() {
  const s = await getSql();
  return s.unsafe(`
    SELECT t.tag, count(*)::int AS n FROM tags t JOIN pages p ON p.id = t.page_id
    WHERE p.deleted_at IS NULL GROUP BY t.tag ORDER BY n DESC, t.tag`);
}

export async function recentPages(limit = 8) {
  const s = await getSql();
  return s.unsafe(`
    SELECT slug, title, type, updated_at, frontmatter->>'review_status' AS review_status
    FROM pages WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT $1`, [limit]);
}

export async function unreadPages(limit = 8) {
  const s = await getSql();
  return s.unsafe(`
    SELECT slug, title, type, updated_at, frontmatter->>'review_status' AS review_status
    FROM pages WHERE deleted_at IS NULL AND frontmatter->>'review_status' IN ('unread', 'unreviewed')
    ORDER BY updated_at DESC LIMIT $1`, [limit]);
}

export async function stats() {
  const s = await getSql();
  const [pages] = await s.unsafe(`SELECT count(*)::int AS n FROM pages WHERE deleted_at IS NULL`);
  const [chunks] = await s.unsafe(`SELECT count(*)::int AS total, count(embedding)::int AS embedded FROM content_chunks`);
  const dims = await s.unsafe(`SELECT DISTINCT vector_dims(embedding) AS dims FROM content_chunks WHERE embedding IS NOT NULL`);
  const links = await s.unsafe(`SELECT link_type, count(*)::int AS n FROM links GROUP BY link_type ORDER BY n DESC`);
  const [tags] = await s.unsafe(`SELECT count(DISTINCT tag)::int AS n FROM tags`);
  return {
    pages: pages.n,
    chunks: { total: chunks.total, embedded: chunks.embedded },
    dims: dims.map(d => d.dims),
    links,
    tags: tags.n,
    by_type: await typeCounts(),
  };
}
