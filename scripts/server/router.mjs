/**
 * Minimal pattern router. Patterns support `:name` (single segment) and `*`
 * (greedy, may span slashes). Captures are percent-decoded.
 */
export function createRouter() {
  const routes = [];

  function compile(pattern) {
    const names = [];
    const source = pattern
      .split('/')
      .map(part => {
        if (part === '*') { names.push('wild'); return '(.+?)'; }
        if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { regex: new RegExp(`^${source}$`), names };
  }

  return {
    route(method, pattern, handler) {
      routes.push({ method, ...compile(pattern), handler, pattern });
    },
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method && route.method !== '*') continue;
        const found = pathname.match(route.regex);
        if (!found) continue;
        const params = {};
        route.names.forEach((name, i) => {
          try { params[name] = decodeURIComponent(found[i + 1]); }
          catch { params[name] = found[i + 1]; }
        });
        return { handler: route.handler, params };
      }
      return null;
    },
  };
}
