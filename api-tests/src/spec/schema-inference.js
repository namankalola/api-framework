const FORMATS = [
  ['date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^https?:\/\/\S+$/],
];

const isUnknown = (s) => !s || Object.keys(s).length === 0; // e.g. items of an empty array

function mergeSchemas(a, b) {
  if (isUnknown(a)) return b;
  if (isUnknown(b)) return a;
  if (a.type !== b.type) {
    // int + float -> number; anything else becomes a union.
    if ([a.type, b.type].every((t) => t === 'integer' || t === 'number')) return { type: 'number' };
    return { anyOf: [a, b] };
  }
  if (a.type === 'object') {
    const keys = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
    return {
      type: 'object',
      properties: Object.fromEntries([...keys].map((k) => [k, mergeSchemas(a.properties[k], b.properties[k]) ?? {}])),
      // Only keys present in every sample are required.
      required: (a.required ?? []).filter((k) => (b.required ?? []).includes(k)),
    };
  }
  if (a.type === 'array') return { type: 'array', items: mergeSchemas(a.items, b.items) ?? {} };
  return a.format === b.format ? a : { type: a.type };
}

/**
 * Infer a JSON schema from one or more example values (e.g. a Postman body or saved response).
 * Every key seen in all samples is marked required; string formats are detected.
 */
export function inferSchema(...samples) {
  return samples.map(inferOne).reduce(mergeSchemas, undefined) ?? {};
}

function inferOne(value) {
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length ? value.map(inferOne).reduce(mergeSchemas) : {} };
  }
  switch (typeof value) {
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inferOne(v)])),
        required: Object.keys(value).filter((k) => value[k] !== null),
      };
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'string': {
      const format = FORMATS.find(([, pattern]) => pattern.test(value))?.[0];
      return format ? { type: 'string', format } : { type: 'string' };
    }
    default:
      return {};
  }
}
