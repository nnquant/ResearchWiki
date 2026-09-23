import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

const backend = 'http://127.0.0.1:8018';

export default defineConfig({
  plugins: [react(), {
    name: 'precompressed-assets',
    async writeBundle(options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!/\.(js|css|html|svg|json)$/.test(fileName)) continue;
        const file = path.join(options.dir ?? 'dist', fileName);
        const data = await fs.readFile(file);
        for (const [ext, compress] of [['br', brotliCompressSync], ['gz', gzipSync]] as const) {
          await fs.writeFile(`${file}.${ext}`, compress(data));
        }
      }
    },
  }],
  build: {
    outDir: 'dist',
    assetsDir: 'app',
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
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
      '/agent': { target: backend, changeOrigin: true, headers: { origin: backend } },
      '/api': { target: backend, changeOrigin: true, headers: { origin: backend } },
      '/assets': { target: backend, changeOrigin: true, headers: { origin: backend } },
    },
  },
});
