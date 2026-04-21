import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  server: {
    port: 3000, // You can change the port if needed
  },
  build: {
    outDir: 'dist',
  },
  publicDir: 'public',
});
