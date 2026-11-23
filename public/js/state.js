// Minimal shared application state with change subscriptions.
export const state = { user: null, meta: null, unread: 0, mode: 'local' };

const listeners = new Set();
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const update = (patch) => {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
};

export const isStaff = () => state.user && state.user.role !== 'student';
export const isAdmin = () => state.user?.role === 'admin';
