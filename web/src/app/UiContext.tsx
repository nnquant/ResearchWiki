import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type ToastKind = 'info' | 'ok' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface Crumb {
  label: string;
  to?: string;
}

interface LightboxState {
  src: string;
  alt: string;
}

interface NewPageState {
  open: boolean;
  type?: string;
  derivedFrom?: string;
}

interface UiState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  paletteOpen: boolean;
  paletteInitial: string;
  openPalette: (initial?: string) => void;
  closePalette: () => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  newPage: NewPageState;
  openNewPage: (type?: string, derivedFrom?: string) => void;
  closeNewPage: () => void;
  lightbox: LightboxState | null;
  openImage: (src: string, alt: string) => void;
  closeImage: () => void;
  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  crumbs: Crumb[];
  setCrumbs: (crumbs: Crumb[]) => void;
}

const UiContext = createContext<UiState | null>(null);

function readStored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored('wiki.theme', 'dark'));
  const [sidebarOpen, setSidebarOpenState] = useState(() => readStored<string>('wiki.sidebar', 'open') !== 'closed');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInitial, setPaletteInitial] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [newPage, setNewPage] = useState<NewPageState>({ open: false });
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    store('wiki.theme', theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(() => setThemeState(t => (t === 'dark' ? 'light' : 'dark')), []);
  const setSidebarOpen = useCallback((open: boolean) => { setSidebarOpenState(open); store('wiki.sidebar', open ? 'open' : 'closed'); }, []);
  const openPalette = useCallback((initial = '') => { setPaletteInitial(initial); setPaletteOpen(true); }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openNewPage = useCallback((type?: string, derivedFrom?: string) => setNewPage({ open: true, type, derivedFrom }), []);
  const closeNewPage = useCallback(() => setNewPage({ open: false }), []);
  const openImage = useCallback((src: string, alt: string) => setLightbox({ src, alt }), []);
  const closeImage = useCallback(() => setLightbox(null), []);
  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++toastId.current;
    setToasts(list => [...list, { id, message, kind }]);
    window.setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const value = useMemo<UiState>(() => ({
    theme, setTheme, toggleTheme,
    sidebarOpen, setSidebarOpen,
    paletteOpen, paletteInitial, openPalette, closePalette,
    helpOpen, setHelpOpen,
    newPage, openNewPage, closeNewPage,
    lightbox, openImage, closeImage,
    toasts, toast, crumbs, setCrumbs,
  }), [theme, setTheme, toggleTheme, sidebarOpen, setSidebarOpen, paletteOpen, paletteInitial, openPalette, closePalette, helpOpen, newPage, openNewPage, closeNewPage, lightbox, openImage, closeImage, toasts, toast, crumbs]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}

/** Declare the top bar breadcrumbs for the current screen. */
export function useCrumbs(crumbs: Crumb[]) {
  const { setCrumbs } = useUi();
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(JSON.parse(key) as Crumb[]);
    return () => setCrumbs([]);
  }, [key, setCrumbs]);
}
