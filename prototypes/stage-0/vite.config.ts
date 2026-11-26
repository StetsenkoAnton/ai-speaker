import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // The browser only talks to localhost; /api is proxied to the Node server that holds the key.
    proxy: {
      '/api': `http://127.0.0.1:${SERVER_PORT}`,
    },
  },
});
