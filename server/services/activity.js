// In-app notifications and the audit trail.
const MAX_AUDIT = 3000;
const MAX_NOTIFICATIONS = 400;

export function notify(store, userId, { type, title, body = '', link = '' }) {
  const list = store.data.notifications;
  list.push({
    id: store.nextId('n'), userId, type, title, body, link, read: false, createdAt: Date.now(),
  });
  if (list.length > MAX_NOTIFICATIONS * 10) store.data.notifications = list.slice(-MAX_NOTIFICATIONS * 5);
  store.touch();
}

export function audit(store, actor, action, target, meta = {}) {
  const list = store.data.audit;
  list.push({
    id: store.nextId('a'), at: Date.now(), actorId: actor?.id ?? 'system', actorName: actor?.name ?? 'System', action, target, meta,
  });
  if (list.length > MAX_AUDIT) list.splice(0, list.length - MAX_AUDIT);
  store.touch();
}
