import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/500.css';
import '@fontsource/noto-sans/600.css';
import '@fontsource/noto-sans/700.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/600.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-sans-mono/400.css';
import '@fontsource/noto-sans-mono/500.css';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/markdown.css';
import './styles/reader.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
