import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DAEMON_PORT = Number(process.env.OD_PORT) || 7456;
const VITE_PORT = Number(process.env.VITE_PORT) || 5173;
const DAEMON_URL = process.env.OD_DAEMON_URL || `http://127.0.0.1:${DAEMON_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: VITE_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: DAEMON_URL,
        changeOrigin: true,
        // Daemon uses SSE on /api/chat — disable Vite's buffering.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache, no-transform';
          });
        },
      },
      // The daemon serves persisted artifacts and the shared device-frame
      // library; proxy them through so the dev SPA can iframe them without
      // hitting a different origin.
      '/artifacts': {
        target: DAEMON_URL,
        changeOrigin: true,
      },
      '/frames': {
        target: DAEMON_URL,
        changeOrigin: true,
      },
    },
  },
});
