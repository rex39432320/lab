// A minimal method + path router with :param support and per-route auth/role
// metadata. Handlers return plain data (serialised as JSON) or a Reply.
import { forbidden, unauthorized } from './errors.js';

/** Explicit response when a handler needs a non-200 status or non-JSON body. */
export class Reply {
  constructor(body, { status = 200, headers = {}, raw = false } = {}) {
    this.body = body;
    this.status = status;
    this.headers = headers;
    this.raw = raw;
  }
}

export const created = (body) => new Reply(body, { status: 201 });

function compile(pattern) {
  const keys = [];
  const source = pattern.replace(/:([A-Za-z]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${source}$`), keys };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, options, handler) {
    if (typeof options === 'function') [options, handler] = [{}, options];
    this.routes.push({ method, ...compile(pattern), options: { auth: true, ...options }, handler });
  }

  get(pattern, options, handler) {
    this.add('GET', pattern, options, handler);
  }
  post(pattern, options, handler) {
    this.add('POST', pattern, options, handler);
  }
  patch(pattern, options, handler) {
    this.add('PATCH', pattern, options, handler);
  }
  delete(pattern, options, handler) {
    this.add('DELETE', pattern, options, handler);
  }

  /** @returns {{route, params} | {methodMismatch: true} | null} */
  match(method, path) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(m[i + 1]);
        } catch {
          params[key] = m[i + 1];
        }
      });
      return { route, params };
    }
    return pathMatched ? { methodMismatch: true } : null;
  }
}

/** Throws when the user is missing or lacks one of the route's allowed roles. */
export function authorize(options, user) {
  if (!options.auth) return;
  if (!user) throw unauthorized();
  if (options.roles && !options.roles.includes(user.role)) throw forbidden();
}
