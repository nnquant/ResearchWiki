import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useJobs, useStatus, useReindex, keys } from '../api/hooks';
import { useUi, useCrumbs } from '../app/UiContext';
import { Loading } from '../app/ui';
import { formatDateTime } from '../lib/format';
import type { Job } from '../api/types';

const STATUS: Record<Job['status'], { label: string; tone: string }> = {
  queued: { label: '排队', tone: '' },
  running: { label: '运行中', tone: 'accent' },
  done: { label: '完成', tone: 'ok' },
  failed: { label: '失败', tone: 'danger' },
  interrupted: { label: '中断', tone: 'warn' },
};

export function ImportPage() {
  useCrumbs([{ label: '导入' }]);
  const { toast } = useUi();
  const client = useQueryClient();
  const { data: status } = useStatus();
  const active = Boolean(status?.active || (status?.queue ?? 0) > 0);
  const { data: jobs, isLoading } = useJobs(active);
  const reindex = useReindex();
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [fileSource, setFileSource] = useState('');
  const [url, setUrl] = useState('');
  const [imaName, setImaName] = useState('');
  const [imaLimit, setImaLimit] = useState(3);

  const done = () => { client.invalidateQueries({ queryKey: keys.jobs }); client.invalidateQueries({ queryKey: keys.status }); };
  const onError = (e: Error) => toast(e.message, 'error');

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const params = new URLSearchParams({ name: file.name });
      if (fileSource.trim()) params.set('source_url', fileSource.trim());
      return api<Job>(`/api/import/file?${params}`, { method: 'POST', rawBody: file });
    },
    onSuccess: () => { toast('文件已提交，开始解析'); done(); },
    onError,
  });
  const importUrl = useMutation({
    mutationFn: (source: string) => api<Job>('/api/import/url', { method: 'POST', body: { url: source } }),
    onSuccess: () => { toast('链接已提交'); setUrl(''); done(); },
    onError,
  });
  const importIma = useMutation({
    mutationFn: () => api<Job>('/api/import/ima', { method: 'POST', body: { name: imaName.trim() || undefined, limit: imaLimit } }),
    onSuccess: () => { toast('IMA 导入已提交'); done(); },
    onError,
  });

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!/\.(pdf|html?|md|txt)$/i.test(file.name)) { toast('只支持 PDF、HTML、MD、TXT', 'error'); return; }
    uploadFile.mutate(file);
  };

  return (
    <div className="content-inner">
      <h1 style={{ fontSize: 'var(--fs-xl)', marginBottom: 4 }}>导入资料</h1>

      <div className="import-grid">
        <div className="card">
          <h3>本地文件</h3>
          <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => fileInput.current?.click()}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files); }}>
            {uploadFile.isPending ? '上传中…' : '拖入或点击选择 PDF / HTML / MD / TXT'}
          </div>
          <input ref={fileInput} type="file" accept=".pdf,.html,.htm,.md,.txt" hidden onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>原文链接（HTML / X 文章建议填写）</label>
            <input className="input" type="url" value={fileSource} onChange={e => setFileSource(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <form className="card" onSubmit={e => { e.preventDefault(); if (url.trim()) importUrl.mutate(url.trim()); }}>
          <h3>网页链接</h3>
          <div className="field">
            <label>公众号或网页文章</label>
            <input className="input" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mp.weixin.qq.com/s/…" required />
            <span className="hint">需要登录的页面无法直接抓取，可另存为 HTML 后用左侧导入。</span>
          </div>
          <button className="btn" type="submit" disabled={importUrl.isPending}>提取并导入</button>
        </form>
        <form className="card" onSubmit={e => { e.preventDefault(); importIma.mutate(); }}>
          <h3>腾讯 IMA 知识库</h3>
          <div className="field">
            <label>知识库名称（留空用默认）</label>
            <input className="input" value={imaName} onChange={e => setImaName(e.target.value)} placeholder="群资料汇总 …" />
          </div>
          <div className="field">
            <label>本次最多导入新资料</label>
            <input className="input" type="number" min={1} max={50} value={imaLimit} onChange={e => setImaLimit(Number(e.target.value))} style={{ width: 100 }} />
          </div>
          <button className="btn" type="submit" disabled={importIma.isPending}>从 IMA 导入</button>
        </form>
      </div>

      <h2 className="section-title">
        处理记录
        <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={reindex.isPending} onClick={() => reindex.mutate(undefined, { onSuccess: () => toast('已加入索引任务'), onError })}>全量更新索引</button>
      </h2>
      {isLoading && <Loading />}
      {jobs && jobs.length === 0 && <p className="muted small">还没有任务。</p>}
      {jobs?.map(job => (
        <div className="job-row" key={job.id}>
          <div>
            <span className={`chip ${STATUS[job.status]?.tone ?? ''}`}>{STATUS[job.status]?.label ?? job.status}</span>
          </div>
          <div>
            <div>{job.label}</div>
            {job.error && <div className="small" style={{ color: 'var(--danger)' }}>{job.error}</div>}
            {job.result !== undefined && job.status === 'done' && (
              <details><summary>结果</summary><pre>{JSON.stringify(job.result, null, 2)}</pre></details>
            )}
          </div>
          <div className="when">{formatDateTime(job.finished_at ?? job.started_at ?? job.queued_at)}</div>
        </div>
      ))}
    </div>
  );
}
