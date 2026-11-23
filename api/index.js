// Vercel serverless entry. Static files are served from /public by Vercel itself.
// Data is in-memory and reseeded per instance (demo use); see README.
import { createApp } from '../server/app.js';
import { campusNow } from '../server/lib/time.js';
import { seedStore } from '../server/seed.js';
import { Store } from '../server/store.js';

const store = new Store();
seedStore(store, campusNow());

const app = createApp({
  store,
  config: { secret: process.env.SESSION_SECRET, demoMode: process.env.DEMO_MODE !== 'false', trustProxy: true },
});

export default app.handler;
