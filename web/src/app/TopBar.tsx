import { Link } from 'react-router';
import { useUi } from './UiContext';

export function TopBar() {
  const { crumbs, sidebarOpen, setSidebarOpen, toggleTheme, theme } = useUi();
  const themeLabel = theme === 'dark' ? '切换为浅色' : '切换为深色';
  return (
    <header className="topbar">
      {!sidebarOpen && (
        <button className="btn ghost sm" title="展开侧栏" onClick={() => setSidebarOpen(true)}>☰</button>
      )}
      <nav className="crumbs" aria-label="位置">
        <Link to="/">首页</Link>
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 8, minWidth: 0 }}>
            <span className="faint">/</span>
            {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span className="current">{c.label}</span>}
          </span>
        ))}
      </nav>
      <div className="actions">
        <button className="btn ghost sm" onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {theme === 'dark' ? <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
            </> : <path d="M20.9 13.1A9 9 0 0 1 10.9 3.1 9 9 0 1 0 20.9 13.1Z" />}
          </svg>
        </button>
      </div>
    </header>
  );
}
