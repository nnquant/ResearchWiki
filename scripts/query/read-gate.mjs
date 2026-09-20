/** Cancellable FIFO admission matching the dedicated pool's connection count. */
export function createReadGate(capacity = 4) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < capacity && queue.length) {
      const item = queue.shift();
      item.signal?.removeEventListener('abort', item.abort);
      if (item.signal?.aborted) { item.reject(item.signal.reason); continue; }
      active++;
      let released = false;
      item.resolve(() => { if (!released) { released = true; active--; drain(); } });
    }
  };
  return signal => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const item = { resolve, reject, signal, abort: () => {
      const i = queue.indexOf(item); if (i !== -1) queue.splice(i, 1);
      reject(signal.reason);
    } };
    signal?.addEventListener('abort', item.abort, { once: true });
    queue.push(item); drain();
  });
}
