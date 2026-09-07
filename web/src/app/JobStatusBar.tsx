import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useStatus, useInvalidateContent } from '../api/hooks';
import { useUi } from './UiContext';

/** Thin progress strip shown while an import or index job is running. */
export function JobStatusBar() {
  const { data } = useStatus();
  const invalidate = useInvalidateContent();
  const { toast } = useUi();
  const lastActive = useRef<string | null>(null);

  useEffect(() => {
    const current = data?.active?.id ?? null;
    if (lastActive.current && !current) {
      invalidate();
      toast('索引已更新', 'ok');
    }
    lastActive.current = current;
  }, [data?.active?.id, invalidate, toast]);

  if (!data || (!data.active && data.queue === 0)) return null;
  return (
    <div className="jobbar" role="status">
      <span className="spinner" />
      <span>{data.active ? `正在处理：${data.active.label}` : '任务排队中'}</span>
      {data.queue > 0 && <span className="faint">还有 {data.queue} 项排队</span>}
      <span className="spacer" style={{ flex: 1 }} />
      <Link to="/import">查看任务</Link>
    </div>
  );
}
