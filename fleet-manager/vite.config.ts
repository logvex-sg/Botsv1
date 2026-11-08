import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    // The renderer only ever runs inside Electron's bundled Chromium, so modern syntax
    // (including top-level await) is safe and avoids needless down-levelling.
    target: 'esnext',
  },
  server: { port: 5173, strictPort: true },
});
