import { Outlet } from 'react-router';
import { useUi } from './UiContext';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { JobStatusBar } from './JobStatusBar';
import { CommandPalette } from './CommandPalette';
import { Hotkeys, HelpDialog } from './Hotkeys';
import { NewPageDialog } from '../pages/NewPageDialog';
import { ImageLightbox } from '../reader/ImageLightbox';
import { Toasts } from './Toasts';

export function Shell() {
  const { sidebarOpen, paletteOpen, newPage, helpOpen } = useUi();
  return (
    <div className="shell" data-sidebar={sidebarOpen}>
      <Sidebar />
      <div className="main">
        <TopBar />
        <JobStatusBar />
        <div className="content" id="content-scroll">
          <Outlet />
        </div>
      </div>
      <Hotkeys />
      {paletteOpen && <CommandPalette />}
      {newPage.open && <NewPageDialog />}
      {helpOpen && <HelpDialog />}
      <ImageLightbox />
      <Toasts />
    </div>
  );
}
