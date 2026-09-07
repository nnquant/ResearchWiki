import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate, useSearchParams } from 'react-router';
import { UiProvider, useUi } from './app/UiContext';
import { Shell } from './app/Shell';
import { Loading } from './app/ui';
import { HomePage } from './pages/HomePage';
import { PageView } from './pages/PageView';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import { ImportPage } from './pages/ImportPage';
import { StatusPage } from './pages/StatusPage';
import { NotFound } from './pages/NotFound';

const GraphPage = lazy(() => import('./pages/GraphPage').then(m => ({ default: m.GraphPage })));
const EditorPage = lazy(() => import('./pages/EditorPage').then(m => ({ default: m.EditorPage })));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="content-inner"><Loading /></div>}>{children}</Suspense>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32 }}>
          <h1 style={{ fontSize: 18 }}>页面渲染出错</h1>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)' }}>{this.state.error.message}</pre>
          <button className="btn" onClick={() => { this.setState({ error: null }); location.reload(); }}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** `/new?type=claim` opens the creation dialog on top of the home page. */
function NewRedirect() {
  const [params] = useSearchParams();
  const { openNewPage } = useUi();
  const type = params.get('type') ?? undefined;
  useEffect(() => { openNewPage(type); }, [openNewPage, type]);
  return <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    errorElement: <NotFound />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'page/*', element: <PageView /> },
      { path: 'edit/*', element: <Lazy><EditorPage /></Lazy> },
      { path: 'graph/*', element: <Lazy><GraphPage /></Lazy> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'status', element: <StatusPage /> },
      { path: 'new', element: <NewRedirect /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <UiProvider>
          <RouterProvider router={router} />
        </UiProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
