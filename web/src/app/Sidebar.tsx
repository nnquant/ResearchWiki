import { useState } from 'react';
import { NavLink, Link } from 'react-router';
import { useUi } from './UiContext';
import { useStatus } from '../api/hooks';
import { PageTree } from './PageTree';
import { AgentAccessDialog } from './AgentAccessDialog';

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
  const [agentOpen, setAgentOpen] = useState(false);
  const issues = status ? [
    !status.services.postgres.ok && '数据库异常',
    (!status.services.ollama.ok || status.services.ollama.model_present === false) && 'Embedding 异常',
  ].filter(Boolean) as string[] : [];
  const hasError = isError || issues.length > 0;
  const issueDetail = isError ? '无法获取服务状态' : [status?.services.postgres.error, status?.services.ollama.error].filter(Boolean).join('；') || issues.join('；');
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Link to="/" className="brand">ResearchWiki</Link>
        <div className="sidebar-header-actions">
          <button className="agent-access-button" title="Agent 接入指南" aria-label="Agent 接入指南" aria-haspopup="dialog" onClick={() => setAgentOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v3M9 3h6M3 12H1m22 0h-2" />
              <rect x="3" y="6" width="18" height="15" rx="4" />
              <path d="M8 11v2m8-2v2m-7 4h6" />
            </svg>
          </button>
          <button className="sidebar-collapse-button" title="收起侧栏（[）" aria-label="收起侧栏" onClick={() => setSidebarOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16" />
            </svg>
          </button>
        </div>
      </div>
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
        <Link to="/status" className="sidebar-service-status" title={`${issueDetail}。点击查看状态详情`}>
          <span className="sidebar-service-dot" aria-hidden="true" />
          <span>{isError ? '服务连接失败' : issues.length === 1 ? issues[0] : `${issues.length} 项服务异常`}</span>
          <span aria-hidden="true">↗</span>
        </Link>
      </div>}
      {agentOpen && <AgentAccessDialog onClose={() => setAgentOpen(false)} />}
    </aside>
  );
}
