// Hash-based router with :param patterns.
const table = [];

export function defineRoute(pattern, loader, options = {}) {
  const keys = [];
  const source = pattern.replace(/:([A-Za-z]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  table.push({ regex: new RegExp(`^${source}$`), keys, loader, options });
}

export function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
}

export function matchRoute(path) {
  for (const route of table) {
    const m = route.regex.exec(path);
    if (m)
      return {
        route,
        params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
      };
  }
  return null;
}

export const go = (to) => {
  location.hash = to;
};

/** Ask the app to re-render the current route (e.g. after a mutation). */
export const refreshRoute = () => window.dispatchEvent(new Event('app:refresh'));
