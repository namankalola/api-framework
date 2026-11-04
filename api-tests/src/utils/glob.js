const cache = new Map();

const toRegExp = (pattern) => {
  if (!cache.has(pattern)) {
    const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    cache.set(pattern, new RegExp(`^${source}$`, 'i'));
  }
  return cache.get(pattern);
};

/** Case-insensitive match with "*" wildcards. */
export const matchesGlob = (value, pattern) => toRegExp(pattern).test(value);

/** Return the first pattern that matches, or undefined. */
export const findMatch = (value, patterns = []) => patterns.find((p) => matchesGlob(value, p));
