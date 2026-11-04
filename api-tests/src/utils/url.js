/** Join a base URL and a path without dropping the base path ("/api/v3" + "/pet"). */
export function joinUrl(baseURL, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Build a query string; arrays repeat the key (OpenAPI default `explode: true`). */
export function buildQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const item of [value].flat()) {
      params.append(key, typeof item === 'object' ? JSON.stringify(item) : String(item));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Substitute "{name}" path params, URL-encoding each value. */
export function fillPath(path, params = {}, operationId = '') {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    if (params[name] === undefined || params[name] === null) {
      throw new Error(`Missing path parameter "${name}"${operationId ? ` for ${operationId}` : ''} (${path})`);
    }
    return encodeURIComponent(String(params[name]));
  });
}
