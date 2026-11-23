// Entry point: wires config, data and the HTTP server.
import crypto from 'node:crypto';
import http from 'node:http';
import { createApp } from './app.js';
import { campusNow } from './lib/time.js';
import { seedStore } from './seed.js';
import { Store } from './store.js';

const port = Number(process.env.PORT) || 3000;
const onCloudRun = Boolean(process.env.K_SERVICE);

const store = new Store({ file: process.env.DATA_FILE });
if (!store.load()) {
  seedStore(store, campusNow());
  store.flush();
}

let secret = process.env.SESSION_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET is not set: using a random secret, so sessions reset on restart.');
}

const app = createApp({
  store,
  config: {
    secret,
    demoMode: process.env.DEMO_MODE !== 'false',
    trustProxy: onCloudRun || process.env.TRUST_PROXY === 'true',
  },
});

const server = http.createServer(app.handler);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, () => console.log(`LabLink listening on http://localhost:${port}`));

function shutdown() {
  store.flush();
  app.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
