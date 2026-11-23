import { CATEGORIES, DEMO_PASSWORD, DEPARTMENTS, PROJECT_KINDS, SESSION_COOKIE } from '../constants.js';
import { HttpError, conflict, tooMany } from '../lib/errors.js';
import { Reply } from '../lib/router.js';
import { hashPassword, hashPasswordSync, serializeCookie, signToken, verifyPassword } from '../lib/security.js';
import { v } from '../lib/validate.js';
import { publicUser } from '../serializers.js';
import { audit } from '../services/activity.js';
import { BOOKING_WINDOW_DAYS, DEFAULT_QUOTA_HOURS } from '../services/scheduling.js';

// Verified against when the account does not exist, so timing doesn't reveal valid emails.
const DUMMY_HASH = hashPasswordSync('not-a-real-password');
const TEN_MINUTES = 10 * 60_000;

export function registerAuth(router, { store, ai, cfg, limiter }) {
  const sessionCookie = (user, secure) => {
    const maxAgeSec = cfg.sessionHours * 3600;
    const token = signToken({ uid: user.id, exp: Date.now() + maxAgeSec * 1000 }, cfg.secret);
    return serializeCookie(SESSION_COOKIE, token, { maxAgeSec, secure });
  };

  router.get('/api/meta', { auth: false }, ({ now }) => ({
    departments: DEPARTMENTS, categories: CATEGORIES, projectKinds: PROJECT_KINDS, now,
    bookingWindowDays: BOOKING_WINDOW_DAYS, defaultQuota: DEFAULT_QUOTA_HOURS,
    ai: { enabled: ai.enabled, model: ai.model }, demoMode: cfg.demoMode,
  }));

  router.get('/api/auth/demo', { auth: false }, () => {
    if (!cfg.demoMode) return { accounts: [] };
    const pick = ['u-aarav', 'u-arjun', 'u-isha', 'u-rao', 'u-menon', 'u-admin'];
    return {
      password: DEMO_PASSWORD,
      accounts: pick.map((id) => store.get('users', id)).filter(Boolean).map((u) => ({ email: u.email, name: u.name, role: u.role, title: u.title })),
    };
  });

  router.post('/api/auth/login', { auth: false }, async ({ body, ip, secure }) => {
    const email = v.email(body.email);
    const password = v.string(body.password, 'password', { max: 200 });
    const byIp = limiter.hit(`login:ip:${ip}`, cfg.limits.loginPerIp, TEN_MINUTES);
    const byEmail = limiter.hit(`login:id:${email}`, cfg.limits.loginPerEmail, TEN_MINUTES);
    if (!byIp.allowed || !byEmail.allowed) throw tooMany('Too many sign-in attempts. Try again in a few minutes.', Math.max(byIp.retryAfterSec, byEmail.retryAfterSec));

    const user = store.data.users.find((u) => u.email === email && u.active !== false);
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new HttpError(401, 'Incorrect email or password.');
    audit(store, user, 'auth.login', user.id);
    return new Reply({ user: publicUser(user) }, { headers: { 'Set-Cookie': sessionCookie(user, secure) } });
  });

  router.post('/api/auth/register', { auth: false }, async ({ body, ip, secure }) => {
    const hit = limiter.hit(`register:${ip}`, 10, 60 * 60_000);
    if (!hit.allowed) throw tooMany('Too many sign-ups from this network. Try again later.', hit.retryAfterSec);
    const name = v.string(body.name, 'name', { min: 2, max: 60 });
    const email = v.email(body.email);
    const department = v.oneOf(body.department, 'department', Object.keys(DEPARTMENTS));
    const password = v.string(body.password, 'password', { min: 8, max: 128 });
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new HttpError(400, 'password: must include a letter and a number', { field: 'password' });
    if (store.data.users.some((u) => u.email === email)) throw conflict('An account with that email already exists.');

    const user = store.insert('users', {
      id: store.nextId('u'), name, email, role: 'student', department, title: 'Student', passwordHash: await hashPassword(password),
      weeklyQuota: DEFAULT_QUOTA_HOURS, karma: 0, active: true, createdAt: Date.now(),
    });
    audit(store, user, 'auth.register', user.id);
    return new Reply({ user: publicUser(user) }, { status: 201, headers: { 'Set-Cookie': sessionCookie(user, secure) } });
  });

  router.post('/api/auth/logout', { auth: false }, ({ secure }) =>
    new Reply({ ok: true }, { headers: { 'Set-Cookie': serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure }) } }));

  router.get('/api/auth/me', { auth: false }, ({ user }) => ({
    user: user ? publicUser(user) : null,
    unread: user ? store.data.notifications.filter((n) => n.userId === user.id && !n.read).length : 0,
  }));
}
