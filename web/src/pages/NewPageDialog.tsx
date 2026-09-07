import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTemplates, useIndex, useCreatePage } from '../api/hooks';
import { ApiError, editUrl } from '../api/client';
import { useUi } from '../app/UiContext';
import { Dialog, TypeDot } from '../app/ui';
import { TYPE_ORDER, TYPE_META, RELATION_LABELS } from '../lib/types';
import { normalizeSegment, normalizeSlug } from '../lib/slug';

export function NewPageDialog() {
  const { newPage, closeNewPage, toast } = useUi();
  const navigate = useNavigate();
  const { data: templates } = useTemplates();
  const { data: index } = useIndex();
  const create = useCreatePage();

  const [type, setType] = useState(newPage.type ?? 'claim');
  const [title, setTitle] = useState('');
  const [slugTail, setSlugTail] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tags, setTags] = useState('');
  const [relationField, setRelationField] = useState<string>('derived_from');
  const [relationTarget, setRelationTarget] = useState(newPage.derivedFrom ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!slugTouched) setSlugTail(normalizeSegment(title)); }, [title, slugTouched]);

  const template = templates?.find(t => t.type === type);
  const dir = template?.dir ?? TYPE_META[type]?.dir ?? 'notes';
  const slug = `${dir}/${normalizeSlug(slugTail)}`;
  const exists = useMemo(() => index?.some(i => i.slug === slug) ?? false, [index, slug]);
  const ordered = useMemo(() => (templates ?? []).slice().sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)), [templates]);
  const relationOptions = template?.fields?.length ? template.fields : ['derived_from', 'supported_by', 'contradicted_by'];
  const targetEntry = useMemo(() => {
    if (!relationTarget) return null;
    const norm = normalizeSlug(relationTarget);
    return index?.find(i => i.slug === norm || i.title === relationTarget) ?? null;
  }, [index, relationTarget]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('请填写标题'); return; }
    if (!normalizeSlug(slugTail)) { setError('slug 不能为空'); return; }
    if (exists) { setError('该 slug 已存在'); return; }
    if (relationTarget && !targetEntry) { setError('关联目标必须是已存在的页面'); return; }
    try {
      const result = await create.mutateAsync({
        type,
        title: title.trim(),
        slug,
        tags: tags.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean),
        relations: targetEntry ? { [relationField]: [targetEntry.slug] } : {},
      });
      toast('页面已创建');
      closeNewPage();
      navigate(editUrl(result.slug));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败');
    }
  };

  return (
    <Dialog title="新建页面" onClose={closeNewPage} wide>
      <form onSubmit={submit}>
        <div className="type-picker">
          {ordered.map(t => (
            <button type="button" key={t.type} className={`type-option ${t.type === type ? 'active' : ''}`} onClick={() => setType(t.type)}>
              <span className="name"><TypeDot type={t.type} />{t.label}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <label>标题</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'claim' ? '例如：低波动率因子在 A 股 2015 年后失效' : '页面标题'} autoFocus />
        </div>
        <div className="field">
          <label>路径</label>
          <div className="row">
            <span className="mono muted">{dir}/</span>
            <input className="input mono" value={slugTail} onChange={e => { setSlugTouched(true); setSlugTail(e.target.value); }} placeholder="自动根据标题生成" />
          </div>
          {exists && <span className="hint error">已存在同名页面</span>}
        </div>
        <div className="field">
          <label>标签（逗号分隔，可选）</label>
          <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="例如：波动率, A股" />
        </div>
        <div className="field">
          <label>关联（可选）</label>
          <div className="row">
            <select className="select" value={relationField} onChange={e => setRelationField(e.target.value)}>
              {relationOptions.map(f => <option key={f} value={f}>{RELATION_LABELS[f] ?? f}</option>)}
            </select>
            <input className="input" list="new-page-targets" value={relationTarget} onChange={e => setRelationTarget(e.target.value)} placeholder="输入页面标题或 slug" />
            <datalist id="new-page-targets">
              {(index ?? []).slice(0, 400).map(i => <option key={i.slug} value={i.slug}>{i.title}</option>)}
            </datalist>
          </div>
          {relationTarget && <span className={`hint ${!targetEntry ? 'error' : ''}`}>{targetEntry ? `→ ${targetEntry.title}` : '未找到对应页面'}</span>}
        </div>
        {error && <div className="error-block" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={closeNewPage}>取消</button>
          <button type="submit" className="btn primary" disabled={create.isPending}>{create.isPending ? '创建中…' : '创建并编辑'}</button>
        </div>
      </form>
    </Dialog>
  );
}
