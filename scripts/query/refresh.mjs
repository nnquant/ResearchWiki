import { buildIndex } from './index.mjs';
import { readGateStats } from './store.mjs';
import { requestMetrics } from './telemetry.mjs';

/** Poll the local manifest and file fingerprints; unchanged revisions are skipped. */
export function startQueryRefresh() {
  if (process.env.WIKI_QUERY_AUTOINDEX === '0') return () => {};
  let running = false;
  const refresh = async () => {
    if (running || readGateStats().queued || requestMetrics().active) return;
    running = true;
    try {
      const result = await buildIndex();
      if (result.failed) console.error(`[research-index] ${result.failed} materials need retry`);
    } catch (e) { console.error(`[research-index] ${e.message}`); }
    finally { running = false; }
  };
  const interval = setInterval(refresh, 15 * 60 * 1000); interval.unref();
  return () => { clearInterval(interval); };
}
