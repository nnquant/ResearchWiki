import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://127.0.0.1:8018';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'app',
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/katex') || id.includes('rehype-katex')) return 'katex';
          if (id.includes('@codemirror') || id.includes('@lezer')) return 'codemirror';
          if (id.includes('node_modules/d3-')) return 'd3';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler') || id.includes('@tanstack')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { origin: backend } },
      '/assets': { target: backend, changeOrigin: true, headers: { origin: backend } },
    },
  },
});
