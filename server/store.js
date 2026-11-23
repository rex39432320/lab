// In-memory data store with optional, atomic JSON-file persistence.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COLLECTIONS = [
  'users',
  'equipment',
  'projects',
  'accessRequests',
  'bookings',
  'waitlist',
  'swaps',
  'notifications',
  'audit',
];

export class Store {
  /** @param {{file?: string}} [options] */
  constructor({ file } = {}) {
    this.file = file;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    this.timer = null;
  }

  /** Load persisted data; returns true when a snapshot was found. */
  load() {
    if (!this.file || !fs.existsSync(this.file)) return false;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const c of COLLECTIONS) this.data[c] = Array.isArray(saved[c]) ? saved[c] : [];
      return this.data.users.length > 0;
    } catch (err) {
      console.error('Could not read data file, starting fresh:', err.message);
      return false;
    }
  }

  nextId(prefix) {
    return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
  }

  get(collection, id) {
    return this.data[collection].find((item) => item.id === id);
  }

  insert(collection, item) {
    this.data[collection].push(item);
    this.touch();
    return item;
  }

  remove(collection, id) {
    const list = this.data[collection];
    const idx = list.findIndex((item) => item.id === id);
    if (idx >= 0) list.splice(idx, 1);
    this.touch();
  }

  /** Mark data as changed; schedules a debounced write when persistence is on. */
  touch() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
    this.timer.unref();
  }

  flush() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not persist data:', err.message);
    }
  }
}
