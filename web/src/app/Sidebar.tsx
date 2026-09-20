import { NavLink, Link } from 'react-router';
import { useUi } from './UiContext';
import { useStatus } from '../api/hooks';
import { PageTree } from './PageTree';

const NAV = [
  { to: '/', label: '研究工作台', end: true },
  { to: '/library', label: '资料库' },
  { to: '/search', label: '检索' },
  { to: '/graph', label: '图谱' },
  { to: '/import', label: '导入' },
  { to: '/status', label: '状态' },
];

export function Sidebar() {
  const { openPalette, openNewPage, setSidebarOpen } = useUi();
  const { data: status, isError } = useStatus();
  const hasError = isError || (status ? !status.services.postgres.ok || !status.services.mcp.ok || !status.services.ollama.ok : false);
  return (
    <aside className="sidebar">
      <Link to="/" className="brand">
        <span>ResearchWiki</span>
      </Link>
      <button className="sidebar-search" onClick={() => openPalette()}>
        <span>搜索页面或内容…</span>


      </button>
      <div className="sidebar-scroll">
        <ul className="nav-list">
          {NAV.map(item => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <span className="label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="nav-section">
          <Link to="/library" className="nav-section-link">页面</Link>
          <button className="btn ghost sm" title="新建页面" aria-label="新建页面" onClick={() => openNewPage()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <PageTree />
      </div>
      {hasError && <div className="sidebar-foot">
        <span className="chip danger" role="status" title={isError ? '无法获取服务状态' : status ? `Postgres ${status.services.postgres.ok ? '正常' : '异常'} · MCP ${status.services.mcp.ok ? '正常' : '异常'} · Ollama ${status.services.ollama.ok ? '正常' : '异常'}` : ''}>
          {isError ? '服务连接失败' : '服务异常'}
        </span>
        <span className="spacer" />
        <button className="btn ghost sm" title="收起侧栏" onClick={() => setSidebarOpen(false)}>‹</button>
      </div>}
    </aside>
  );
}
