import { useUi } from './UiContext';

export function Toasts() {
  const { toasts } = useUi();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
      ))}
    </div>
  );
}
