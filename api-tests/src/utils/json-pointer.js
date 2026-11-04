const decode = (token) => decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~');
export const encodePointerToken = (token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1');

/** Resolve a local JSON pointer such as "#/components/schemas/Pet" against `doc`. */
export function resolvePointer(doc, ref) {
  if (!ref.startsWith('#')) throw new Error(`Only local $refs are supported after bundling, got "${ref}"`);
  return ref
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map(decode)
    .reduce((node, key) => {
      if (node == null || !(key in node)) throw new Error(`Unresolvable $ref "${ref}"`);
      return node[key];
    }, doc);
}

/** Build a pointer from path segments: ['paths', '/pet', 'post'] -> "#/paths/~1pet/post". */
export const toPointer = (segments) => `#/${segments.map(encodePointerToken).join('/')}`;

/** Follow a chain of $refs until a concrete object is reached. */
export function deref(doc, node) {
  let current = node;
  const seen = new Set();
  while (current && typeof current === 'object' && typeof current.$ref === 'string') {
    if (seen.has(current.$ref)) throw new Error(`Circular $ref chain at "${current.$ref}"`);
    seen.add(current.$ref);
    current = resolvePointer(doc, current.$ref);
  }
  return current;
}
