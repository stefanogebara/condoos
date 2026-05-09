import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const onWindows = process.platform === 'win32';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    // Audit L-N5 — the production bundle was 644 KB (~189 KB gzipped) in a
    // single chunk. Split out the largest deps so a resident hitting /app
    // doesn't pay the full board-side dep tree on first load. React core
    // stays warm across all routes; everything else can lazy-attach.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'icons': ['lucide-react'],
          'auth-vendor': ['@react-oauth/google'],
          'http-vendor': ['axios', 'react-hot-toast'],
        },
      },
    },
    // 600 is the Vite default; bump slightly so the new react-vendor chunk
    // doesn't trigger the noisy chunk-size warning on every build.
    chunkSizeWarningLimit: 700,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
    // chokidar's native watcher misses edits on Windows under some Git Bash /
    // WSL setups, leading Vite to serve a stale module from its in-memory
    // transform cache even though the file changed. Polling is a few % more
    // CPU but eliminates the "edited a file, refresh, still old" flake.
    watch: onWindows ? { usePolling: true, interval: 200 } : undefined,
  },
});
