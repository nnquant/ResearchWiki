import { buildIndex } from './index.mjs';

/** Poll the local manifest and file fingerprints; unchanged revisions are skipped. */
export function startQueryRefresh() {
  if (process.env.WIKI_QUERY_AUTOINDEX === '0') return () => {};
  let running = false;
  const refresh = async () => {
    if (running) return;
    running = true;
    try {
      const result = await buildIndex();
      if (result.failed) console.error(`[research-index] ${result.failed} materials need retry`);
    } catch (e) { console.error(`[research-index] ${e.message}`); }
    finally { running = false; }
  };
  const initial = setTimeout(refresh, 30000); initial.unref();
  const interval = setInterval(refresh, 5 * 60 * 1000); interval.unref();
  return () => { clearTimeout(initial); clearInterval(interval); };
}
