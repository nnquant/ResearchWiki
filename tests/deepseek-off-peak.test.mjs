import test from 'node:test';
import assert from 'node:assert/strict';
import {deepseekOffPeakWindow,requireDeepseekOffPeak} from '../scripts/deepseek-off-peak.mjs';
const windowAt=value=>deepseekOffPeakWindow(new Date(value));
test('Beijing weekday pricing boundaries and request headroom',()=>{
  assert.equal(windowAt('2026-09-10T08:49:29+08:00').allowed,true);
  assert.equal(windowAt('2026-09-10T08:49:30+08:00').allowed,false);
  assert.equal(windowAt('2026-09-10T09:00:00+08:00').nextResumeAt,'2026-09-10T04:00:00.000Z');
  assert.equal(windowAt('2026-09-10T12:00:00+08:00').allowed,true);
  assert.equal(windowAt('2026-09-10T13:49:30+08:00').nextResumeAt,'2026-09-10T10:00:00.000Z');
  assert.equal(windowAt('2026-09-10T17:59:59+08:00').allowed,false);
  assert.equal(windowAt('2026-09-10T18:00:00+08:00').allowed,true);
});
test('weekends stay available and timezone uses Beijing across UTC date boundaries',()=>{
  assert.equal(windowAt('2026-09-12T10:00:00+08:00').allowed,true);
  assert.equal(windowAt('2026-09-13T15:00:00+08:00').allowed,true);
  assert.equal(windowAt('2026-09-14T01:00:00Z').allowed,false);
  assert.equal(windowAt('2026-09-13T17:00:00Z').allowed,true);
});
test('off-peak guard blocks before a request without consuming retries',()=>{
  const originalNow=Date.now;
  Date.now=()=>Date.parse('2026-09-10T16:00:00+08:00');
  try {
    assert.doesNotThrow(()=>requireDeepseekOffPeak({offPeakOnly:false}));
    assert.throws(()=>requireDeepseekOffPeak({offPeakOnly:true}),e=>e.code==='OFF_PEAK_WAIT'&&e.nextResumeAt==='2026-09-10T10:00:00.000Z');
  } finally {Date.now=originalNow;}
});
