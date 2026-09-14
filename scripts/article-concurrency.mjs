export function articleConcurrency(value = 1) {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('文章并发数必须为 1–8');
  return concurrency;
}

/** Start a bounded group, retain every outcome, and let the caller publish in queue order. */
export function startArticleBatch(records, {concurrency = 1, stage, shouldPause = async () => false,
  onStart = async () => {}, onError = async () => {}, clock = Date.now} = {}) {
  return records.slice(0, articleConcurrency(concurrency)).map(record => ({record, ready: (async () => {
    const started = clock();
    try {
      if (await shouldPause()) throw Object.assign(new Error('文章批次已暂停'), {code: 'ARTICLE_PAUSED'});
      await onStart(record);
      const staged = await stage(record);
      return {record, staged, started, extractionSeconds: (clock() - started) / 1000};
    } catch (error) {
      await onError(error, record);
      return {record, error, started, extractionSeconds: (clock() - started) / 1000};
    }
  })()}));
}
