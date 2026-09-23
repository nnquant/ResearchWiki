import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Loading, ErrorBlock } from './ui';

type Access = { available: boolean; reason?: string; document_path?: string; installer_path?: string };

export function AgentAccessDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['agent-access'], queryFn: ({ signal }) => api<Access>('/api/agent-access', { signal }), staleTime: 0,
  });
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  const base = new URL('/agent', window.location.origin).href;
  const guide = data?.document_path ? new URL(data.document_path, window.location.origin).href : '';
  const installer = data?.installer_path ? new URL(data.installer_path, window.location.origin).href : '';
  // Explicit overrides also handle a reverse proxy whose canonical URL differs
  // from the address the user is currently visiting.
  const prompt = guide && installer ? `请读取 ${guide} 中的 ResearchWiki 一键安装指南，并从 ${installer} 下载安装脚本。安装 research-wiki Skill 时传入 --base-url "${base}"（其他 Agent 可用 --target 指定技能目录），然后执行 describe 验证连接。不要在回复中展示 token。` : '';

  async function copyPrompt() {
    setCopyMessage('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(prompt);
      setCopyMessage('已复制，粘贴给你的 Agent 即可');
    } catch {
      // Public HTTP pages lack the secure-context Clipboard API.
      input.current?.focus(); input.current?.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* manual selection remains available */ }
      setCopyMessage(copied ? '已复制，粘贴给你的 Agent 即可' : '已选中提示词，请按 Ctrl+C（Mac：⌘C）复制');
    }
  }

  return createPortal(
    <dialog ref={dialog} className="dialog agent-access-dialog" aria-labelledby="agent-access-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => event.stopPropagation()}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}>
      <div className="agent-access-heading">
        <h2 id="agent-access-title">Agent 接入指南</h2>
        <button className="btn ghost sm" onClick={onClose} aria-label="关闭接入指南" title="关闭">×</button>
      </div>
      <p className="muted">让你的 Agent 搜索研究材料、按标签筛选，并读取原文证据。</p>
      {isPending ? <Loading label="加载安装指南…" /> : error ? <>
        <ErrorBlock error={error} title="安装指南加载失败" />
        <button className="btn sm" onClick={() => void refetch()}>重试</button>
      </> : !data?.available ? <p className="agent-access-note">{data?.reason ?? '安装指南暂不可用'}</p> : <>
        <label className="agent-access-label" htmlFor="agent-install-prompt">复制下面的提示词，发给你的 Agent</label>
        <textarea id="agent-install-prompt" ref={input} className="textarea agent-access-prompt" value={prompt} readOnly rows={8} spellCheck={false} />
        <div className="agent-access-actions">
          <button className="btn primary" onClick={() => void copyPrompt()}>复制接入提示词</button>
          <a className="btn ghost" href={guide} target="_blank" rel="noreferrer">安装文档 ↗</a>
        </div>
        <p className="small agent-access-feedback" role="status">{copyMessage}</p>
        <dl className="agent-access-endpoints">
          <dt>当前服务</dt><dd>{base}</dd>
          <dt>MCP</dt><dd>{base}/mcp</dd>
        </dl>
        <p className="muted small">链接随当前页面的协议、地址和端口自动生成。接收方需能访问此地址，并安装 Node.js 22+。</p>
        <p className="faint small">安装链接包含只读凭据，请仅分享给授权使用者。</p>
      </>}
    </dialog>, document.body,
  );
}
