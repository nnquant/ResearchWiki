import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { typeColor, typeLabel, STATUS_LABELS } from '../lib/types';

export function TypeBadge({ type, className = '' }: { type: string | null | undefined; className?: string }) {
  const style = { '--badge-color': typeColor(type) } as CSSProperties;
  return (
    <span className={`badge ${className}`} style={style}>
      <span className="dot" />
      {typeLabel(type)}
    </span>
  );
}

export function TypeDot({ type, size = 8 }: { type: string; size?: number }) {
  return <span className="dot" style={{ width: size, height: size, borderRadius: '50%', background: typeColor(type), display: 'inline-block', flex: 'none' }} />;
}

export function StatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const tone = status === 'verified' || status === 'reviewed' ? 'ok' : status === 'rejected' ? 'danger' : status === 'unread' || status === 'unreviewed' ? 'warn' : '';
  return <span className={`chip ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="spinner" />
      {label && <span className="muted small">{label}</span>}
    </span>
  );
}

export function Loading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorBlock({ error, title }: { error: unknown; title?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="error-block">
      {title && <strong>{title}：</strong>}
      {message}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}

export function Tag({ tag, link = true }: { tag: string; link?: boolean }) {
  if (!link) return <span className="chip">{tag}</span>;
  return <Link className="chip chip-button" to={`/library?tag=${encodeURIComponent(tag)}`}>{tag}</Link>;
}

export function Dialog({ title, children, onClose, wide = false }: { title?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="overlay center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
