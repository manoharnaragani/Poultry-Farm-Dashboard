import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import viteConfig from '../vite.config.js';

export async function setupVite(app, server) {
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: { middlewareMode: true, hmr: { server }, allowedHosts: true },
    appType: 'custom',
  });
  app.use(vite.middlewares);
  app.use('*', async (req, res, next) => {
    try {
      const templatePath = path.resolve(process.cwd(), 'client', 'index.html');
      const template = await fs.readFile(templatePath, 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error);
      next(error);
    }
  });
}

export function serveStatic(app) {
  const distPath = path.resolve(process.cwd(), 'dist', 'public');
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    expressStatic(req, res, next);
  });
  app.use('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

import express from 'express';
const expressStatic = express.static(path.resolve(process.cwd(), 'dist', 'public'));
