export const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

export function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

/**
 * Recursively merge plain objects. Arrays and other values from `override` replace `base`.
 * An `undefined` override keeps the base value. Inputs are never mutated.
 */
export function deepMerge(base, override) {
  if (override === undefined) return clone(base);
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);

  const result = clone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? deepMerge(result[key], value) : clone(value);
  }
  return result;
}
