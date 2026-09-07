import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useUi } from './UiContext';
import { isEditableTarget, modKey } from '../lib/hotkeys';
import { Dialog } from './ui';

/** Global keyboard shortcuts. Editors and inputs swallow single-key shortcuts. */
export function Hotkeys() {
  const ui = useUi();
  const navigate = useNavigate();
  const location = useLocation();
  const pendingG = useRef(false);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const u = uiRef.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (u.paletteOpen) u.closePalette(); else u.openPalette();
        return;
      }
      if (e.key === 'Escape') {
        if (u.lightbox) { u.closeImage(); return; }
        if (u.paletteOpen) { u.closePalette(); return; }
        if (u.helpOpen) { u.setHelpOpen(false); return; }
        if (u.newPage.open) { u.closeNewPage(); return; }
        return;
      }
      if (mod || e.altKey || isEditableTarget(e.target) || u.paletteOpen || u.newPage.open) return;
      if (e.key === '/') { e.preventDefault(); u.openPalette(); return; }
      if (e.key === '?') { u.setHelpOpen(!u.helpOpen); return; }
      if (e.key === '[' || e.key === ']') { u.setSidebarOpen(!u.sidebarOpen); return; }
      if (e.key === 'n') { u.openNewPage(); return; }
      if (e.key === 'e' && location.pathname.startsWith('/page/')) {
        navigate(location.pathname.replace(/^\/page\//, '/edit/'));
        return;
      }
      if (e.key === 'g') { pendingG.current = true; window.setTimeout(() => { pendingG.current = false; }, 900); return; }
      if (pendingG.current) {
        pendingG.current = false;
        if (e.key === 'g' && location.pathname.startsWith('/page/')) { navigate(location.pathname.replace(/^\/page\//, '/graph/')); return; }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, location.pathname]);

  return null;
}

export function HelpDialog() {
  const { setHelpOpen } = useUi();
  const M = modKey();
  return (
    <Dialog title="键盘快捷键" onClose={() => setHelpOpen(false)}>
      <div className="shortcuts">
        <div><span>命令面板 / 搜索</span><span>{M} K</span></div>
        <div><span>快速搜索</span><span>/</span></div>
        <div><span>新建页面</span><span>n</span></div>
        <div><span>编辑当前页</span><span>e</span></div>
        <div><span>保存（编辑器内）</span><span>{M} S</span></div>
        <div><span>当前页图谱</span><span>g g</span></div>
        <div><span>收起 / 展开侧栏</span><span>[</span></div>
        <div><span>列表中上下移动</span><span>j k</span></div>
        <div><span>关闭浮层</span><span>Esc</span></div>
      </div>
      <div className="dialog-actions"><button className="btn" onClick={() => setHelpOpen(false)}>关闭</button></div>
    </Dialog>
  );
}
