import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // File change events don't reach WSL from the Windows drive, so poll.
    watch: { usePolling: true, interval: 300 },
  },
});
