import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { useRawPage, useIndex, useSavePage } from '../api/hooks';
import { ApiError, pageUrl } from '../api/client';
import { useUi, useCrumbs } from '../app/UiContext';
import { Loading, ErrorBlock, Dialog } from '../app/ui';
import { CodeEditor } from '../editor/CodeEditor';
import { lintPage } from '../editor/frontmatterLint';
import { Markdown } from '../reader/Markdown';
import { relativeTime } from '../lib/format';
import type { Diagnostic } from '@codemirror/lint';
import type { ValidationError } from '../api/types';

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '');
}

export function EditorPage() {
  const params = useParams();
  const slug = params['*'] ?? '';
  const navigate = useNavigate();
  const { theme, toast } = useUi();
  const { data: raw, isLoading, error } = useRawPage(slug);
  const { data: index } = useIndex();
  const save = useSavePage();

  const [text, setText] = useState<string | null>(null);
  const [baseHash, setBaseHash] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [split, setSplit] = useState(() => { try { return localStorage.getItem('wiki.editor.split') === '1'; } catch { return false; } });
  const [conflict, setConflict] = useState<{ current_hash: string; current_content: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<ValidationError[]>([]);
  const [problems, setProblems] = useState<Diagnostic[]>([]);
  const textRef = useRef<string | null>(null);
  textRef.current = text;

  useEffect(() => {
    if (raw && text === null) { setText(raw.content); setBaseHash(raw.hash); }
  }, [raw, text]);

  const dirty = raw !== undefined && text !== null && text !== raw.content && baseHash === raw.hash ? true : (text !== null && savedAt !== null ? false : raw !== undefined && text !== null && text !== raw.content);
  const title = useMemo(() => (text ?? '').match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? slug, [text, slug]);
  useCrumbs([{ label: '编辑' }, { label: title }]);

  const lint = useCallback((value: string) => {
    const result = lintPage(value, slug, index ?? []);
    setProblems(result.diagnostics);
    return result.diagnostics;
  }, [slug, index]);

  const blocker = useBlocker(dirty && !save.isPending);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const doSave = useCallback(async (force = false) => {
    const content = textRef.current;
    if (content === null || !raw) return;
    if (problems.some(p => p.severity === 'error')) { toast('页面有错误，请先修正 frontmatter', 'error'); return; }
    setServerErrors([]);
    try {
      const result = await save.mutateAsync({ slug: raw.slug, content, baseHash, force });
      setBaseHash(result.hash);
      setSavedAt(new Date().toISOString());
      setConflict(null);
      toast('已保存，索引更新已排队', 'ok');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && typeof e.data.current_content === 'string') {
        setConflict({ current_hash: String(e.data.current_hash), current_content: e.data.current_content });
      } else if (e instanceof ApiError && e.status === 422 && Array.isArray(e.data.errors)) {
        setServerErrors(e.data.errors as ValidationError[]);
        toast('服务器校验未通过', 'error');
      } else {
        toast(e instanceof Error ? e.message : '保存失败', 'error');
      }
    }
  }, [raw, baseHash, problems, save, toast]);

  const toggleSplit = () => {
    setSplit(s => { try { localStorage.setItem('wiki.editor.split', s ? '0' : '1'); } catch { /* ignore */ } return !s; });
  };

  if (isLoading || (raw && text === null)) return <div className="content-inner"><Loading /></div>;
  if (error || !raw) return <div className="content-inner"><ErrorBlock error={error ?? '无法加载'} title="无法打开编辑器" /></div>;
  if (!raw.editable) {
    return (
      <div className="content-inner">
        <div className="empty">
          <h3>此页面只读</h3>
          <p>{raw.edit_reason}</p>
          <Link className="btn" to={pageUrl(raw.slug)}>返回阅读</Link>
        </div>
      </div>
    );
  }

  const errorCount = problems.filter(p => p.severity === 'error').length + serverErrors.length;
  const warnCount = problems.filter(p => p.severity === 'warning').length;
  const modifiedSinceSave = text !== null && savedAt !== null && baseHash !== null && dirty;

  return (
    <div className="editor-page">
      <div className="editor-bar">
        <span className="title" title={raw.slug}>{title}</span>
        <span className="mono faint">{raw.slug}</span>
        <span className="spacer" style={{ flex: 1 }} />
        {errorCount > 0 && <span className="chip danger">{errorCount} 个错误</span>}
        {warnCount > 0 && <span className="chip warn">{warnCount} 个警告</span>}
        {dirty || modifiedSinceSave ? <span className="chip accent">未保存</span> : savedAt ? <span className="chip ok">已保存 {relativeTime(savedAt)}</span> : <span className="chip">未修改</span>}
        <button className={`btn sm ${split ? 'active' : ''}`} onClick={toggleSplit}>{split ? '关闭预览' : '分屏预览'}</button>
        <Link className="btn sm" to={pageUrl(raw.slug)}>{dirty ? '放弃并返回' : '返回阅读'}</Link>
        <button className="btn primary sm" disabled={save.isPending || !dirty} onClick={() => doSave(false)}>
          {save.isPending ? '保存中…' : '保存并更新索引'}
        </button>
      </div>
      <div className="editor-body" data-split={split}>
        <CodeEditor initial={raw.content} dark={theme === 'dark'} index={index ?? []} lint={lint} onChange={setText} onSave={() => doSave(false)} />
        {split && (
          <div className="editor-preview">
            <Markdown markdown={stripFrontmatter(text ?? '')} />
          </div>
        )}
      </div>
      {(problems.length > 0 || serverErrors.length > 0) && (
        <div className="editor-problems">
          <ul>
            {serverErrors.map((e, i) => <li key={`s${i}`} style={{ color: 'var(--danger)' }}>{e.field}：{e.message}</li>)}
            {problems.map((p, i) => <li key={i} style={{ color: p.severity === 'error' ? 'var(--danger)' : 'var(--warn)' }}>{p.message}</li>)}
          </ul>
        </div>
      )}

      {conflict && (
        <Dialog title="页面已被其他人修改" onClose={() => setConflict(null)} wide>
          <p className="muted small" style={{ marginBottom: 12 }}>磁盘上的文件在你打开之后发生了变化（可能由 Agent、CLI 或另一个窗口写入）。你可以放弃本地修改并重新加载，或用你的版本覆盖。</p>
          <div className="diff-view">
            <div><div className="faint" style={{ marginBottom: 4 }}>磁盘上的版本</div><pre>{conflict.current_content}</pre></div>
            <div><div className="faint" style={{ marginBottom: 4 }}>你的版本</div><pre>{text}</pre></div>
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={() => { setText(conflict.current_content); setBaseHash(conflict.current_hash); setConflict(null); navigate(0); }}>重新加载磁盘版本</button>
            <button className="btn danger" onClick={() => { setBaseHash(conflict.current_hash); setConflict(null); void doSave(true); }}>以我的版本覆盖</button>
          </div>
        </Dialog>
      )}

      {blocker.state === 'blocked' && (
        <Dialog title="有未保存的修改" onClose={() => blocker.reset()}>
          <p className="muted small">离开后修改会丢失。</p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => blocker.reset()}>继续编辑</button>
            <button className="btn danger" onClick={() => blocker.proceed()}>放弃修改</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
