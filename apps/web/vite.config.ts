import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  plugins: [vue()],
  server: {
    port: Number(process.env.CONTROL_PORT ?? 5173),
    strictPort: true,
    // The browser only talks to localhost; the Node server owns state and keys.
    proxy: {
      '/api': `http://127.0.0.1:${SERVER_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true },
    },
  },
});
