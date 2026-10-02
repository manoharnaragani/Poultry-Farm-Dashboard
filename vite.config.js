import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(process.cwd(), 'client'),
  publicDir: path.resolve(process.cwd(), 'client', 'public'),
  build: {
    outDir: path.resolve(process.cwd(), 'dist', 'public'),
    emptyOutDir: true,
  },
  server: { host: true },
});
