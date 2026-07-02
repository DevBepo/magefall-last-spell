import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  build: { outDir: '../dist/client', emptyOutDir: true },
  resolve: { alias: { '@shared': new URL('./shared', import.meta.url).pathname } },
  server: {
    host: '127.0.0.1', port: Number(process.env.VITE_PORT ?? 5173),
    proxy: { '/socket.io': { target: `http://127.0.0.1:${process.env.SERVER_PORT ?? 3000}`, ws: true } },
  },
});
