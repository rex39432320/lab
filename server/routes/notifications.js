import { notFound } from '../lib/errors.js';

export function registerNotifications(router, { store }) {
  router.get('/api/notifications', ({ user }) => {
    const mine = store.data.notifications.filter((n) => n.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
    return { items: mine.slice(0, 40), unread: mine.filter((n) => !n.read).length };
  });

  router.post('/api/notifications/read-all', ({ user }) => {
    for (const n of store.data.notifications) if (n.userId === user.id) n.read = true;
    store.touch();
    return { ok: true };
  });

  router.post('/api/notifications/:id/read', ({ params, user }) => {
    const n = store.get('notifications', params.id);
    if (!n || n.userId !== user.id) throw notFound('Notification not found.');
    n.read = true;
    store.touch();
    return { ok: true };
  });
}
