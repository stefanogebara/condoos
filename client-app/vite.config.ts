import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const onWindows = process.platform === 'win32';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
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
