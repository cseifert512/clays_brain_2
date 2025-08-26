import { defineConfig } from 'vite';

export default defineConfig({
  base: '/clays_brain_2/',
  server: {
    port: 3000, // You can change the port if needed
  },
  build: {
    outDir: 'dist',
  },
  publicDir: 'public',
});
