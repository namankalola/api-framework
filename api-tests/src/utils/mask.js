const MASK = '***';

const lowerSet = (items) => new Set(items.map((i) => i.toLowerCase()));

export function maskHeaders(headers = {}, sensitive = []) {
  const keys = lowerSet(sensitive);
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, keys.has(k.toLowerCase()) ? MASK : v]));
}

/** Recursively mask object fields whose key matches one of `fields` (case-insensitive). */
export function maskFields(value, fields = []) {
  const keys = lowerSet(fields);
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, keys.has(k.toLowerCase()) ? MASK : walk(v)]));
    }
    return node;
  };
  return walk(value);
}

/** Mask query-string values whose name is sensitive. */
export function maskUrl(url, fields = []) {
  try {
    const parsed = new URL(url);
    const keys = lowerSet(fields);
    for (const key of [...parsed.searchParams.keys()]) {
      if (keys.has(key.toLowerCase())) parsed.searchParams.set(key, MASK);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
