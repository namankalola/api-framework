/** Read a value with a simple path: "$.data.items[0].id" or "data.items.0.id". */
export function getByPath(obj, path) {
  const keys = path
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  return keys.reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** Replace every "$.x.y" string inside `template` with the value read from `source`. */
export function resolveTemplate(template, source) {
  if (typeof template === 'string') return template.startsWith('$.') ? getByPath(source, template) : template;
  if (Array.isArray(template)) return template.map((t) => resolveTemplate(t, source));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, resolveTemplate(v, source)]));
  }
  return template;
}
