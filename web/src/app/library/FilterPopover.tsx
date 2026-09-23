import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Props {
  label: string;
  /** Selected value summary; when present the button shows "label：value" and reads as active. */
  value?: string;
  panelLabel?: string;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}

/** A filter-dimension button that opens an anchored panel. Keys stay inside so page hotkeys (j/k/Enter) don't fire. */
export function FilterPopover({ label, value, panelLabel, wide, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('input, [aria-checked="true"], [aria-pressed="true"], button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    // Rows can unmount under the cursor (e.g. a tag moving into "已选"), dropping focus to <body>; listen globally.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !root.current?.contains(document.activeElement)) { event.preventDefault(); setOpen(false); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onEscape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onEscape); };
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };

  return (
    <div className="filter-popover" ref={root}
      onBlur={event => { if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
      }}>
      <button type="button" ref={trigger} className={`filter-btn${value ? ' is-active' : ''}`}
        aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}>
        <span className="filter-btn-text">{label}{value && <>：<strong>{value}</strong></>}</span>
      </button>
      {open && (
        <div ref={panel} id={id} className={`filter-panel${wide ? ' is-wide' : ''}`} role="dialog" aria-label={panelLabel ?? label}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export interface OptionItem { value: string; label: string; count?: number }

/** Single-select list; the leading "全部" row clears the dimension. */
export function OptionMenu({ options, value, allLabel, onSelect }: { options: OptionItem[]; value: string; allLabel: string; onSelect: (value: string | null) => void }) {
  const rows: OptionItem[] = [{ value: '', label: allLabel }, ...options];
  return (
    <div className="filter-options" role="radiogroup">
      {rows.map(option => {
        const checked = option.value === value;
        return (
          <button type="button" role="radio" aria-checked={checked} key={option.value || '__all'}
            className={`filter-option${checked ? ' is-checked' : ''}`}
            onClick={() => onSelect(option.value || null)}
            onKeyDown={event => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const sibling = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
              (sibling as HTMLElement | null)?.focus();
            }}>
            <span className="filter-option-check" aria-hidden="true">{checked ? '✓' : ''}</span>
            <span className="filter-option-label">{option.label}</span>
            {option.count != null && <span className="filter-option-count">{option.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}
