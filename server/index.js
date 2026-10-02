import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import net from 'node:net';
import { registerAuthRoutes, initAuth } from './localAuth.js';
import { initSchema } from './db/schema.js';
import { closePool } from './db/pool.js';
import { registerLocalFarmApi } from './localFarmApi.js';
import { setupVite, serveStatic } from './vite.js';

const isProduction = process.argv.includes('--production');
const HOST = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function findPort(start = Number(process.env.PORT || 3000)) {
  for (let port = start; port < start + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('No available port found.');
}

// Connect to PostgreSQL and prepare tables before accepting requests.
try {
  await initSchema();
  await initAuth();
} catch (error) {
  console.error('\nCould not start: ' + error.message);
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === '28P01' || error.code === '3D000') {
    console.error('Check DATABASE_URL in your .env file (host, user, password and database name).');
  }
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // needed behind hosting HTTPS proxies
const server = createServer(app);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

registerAuthRoutes(app);
registerLocalFarmApi(app);

if (isProduction) serveStatic(app);
else await setupVite(app, server);

const port = isProduction ? Number(process.env.PORT || 3000) : await findPort();
server.listen(port, HOST, () => {
  console.log(`NestLedger running at http://localhost:${port}/`);
  console.log(`Mode: ${isProduction ? 'production' : 'development'}`);
  console.log('Database: PostgreSQL connected');
  if (!isProduction && !process.env.ADMIN_PASSWORD) console.log('Local admin: admin@nestledger.local / Admin@123 (change by setting ADMIN_PASSWORD in .env)');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); closePool().finally(() => process.exit(0)); });
}
