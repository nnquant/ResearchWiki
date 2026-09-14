// Official schedule checked 2026-09-12:
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// Beijing weekdays: peak 09:00–12:00 and 14:00–18:00.
const HOUR = 3600000, DAY = 24 * HOUR, BEIJING_OFFSET = 8 * HOUR;

export function deepseekOffPeakWindow(at = Date.now(), timeoutMs = 600000) {
  const timestamp = at instanceof Date ? at.getTime() : Number(at);
  if (!Number.isFinite(timestamp) || !Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('Invalid off-peak time budget');
  const local = new Date(timestamp + BEIJING_OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - BEIJING_OFFSET;
  // Leave room for the complete request and a 30-second clock/network margin.
  const reserve = timeoutMs + 30000;
  for (let day = 0; day < 8; day++) {
    const base = midnight + day * DAY;
    const weekday = new Date(base + BEIJING_OFFSET).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const [startHour, endHour] of [[9, 12], [14, 18]]) {
      const start = base + startHour * HOUR, end = base + endHour * HOUR;
      if (timestamp >= start - reserve && timestamp < end) return { allowed: false, nextResumeAt: new Date(end).toISOString() };
      if (timestamp < start - reserve) return { allowed: true, stopStartingAt: new Date(start - reserve).toISOString() };
    }
  }
  throw new Error('Could not resolve the next DeepSeek billing window');
}

export function requireDeepseekOffPeak(cfg) {
  if (!cfg.offPeakOnly) return;
  const window = deepseekOffPeakWindow(Date.now(), cfg.requestTimeoutMs ?? 600000);
  if (!window.allowed) throw Object.assign(new Error('等待 DeepSeek 官方闲时计费时段'), { code: 'OFF_PEAK_WAIT', nextResumeAt: window.nextResumeAt });
}
