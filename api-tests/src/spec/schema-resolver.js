import { resolvePointer } from '../utils/json-pointer.js';

const TRUNCATED = Symbol('truncated');

/**
 * Inline local $refs so the schema can be used for data generation.
 * Recursive schemas are cut at `maxDepth`; optional properties beyond that depth are dropped.
 *
 * @param {object} doc     bundled OpenAPI document that $refs point into
 * @param {object} schema  schema that may contain $refs
 * @param {object} [options]
 * @param {number} [options.maxDepth=4]
 * @param {'request'|'response'} [options.direction]  request drops readOnly props, response drops writeOnly
 */
export function resolveSchema(doc, schema, { maxDepth = 4, direction } = {}) {
  const skipFlag = direction === 'request' ? 'readOnly' : direction === 'response' ? 'writeOnly' : null;

  const walk = (node, depth) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n) => walk(n, depth));

    if (typeof node.$ref === 'string') {
      if (depth >= maxDepth) return TRUNCATED;
      const { $ref, ...siblings } = node;
      return walk({ ...resolvePointer(doc, $ref), ...siblings }, depth + 1);
    }

    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value && typeof value === 'object') {
        out.properties = {};
        for (const [prop, propSchema] of Object.entries(value)) {
          const resolved = walk(propSchema, depth);
          if (resolved === TRUNCATED || (skipFlag && resolved?.[skipFlag])) continue;
          out.properties[prop] = resolved;
        }
      } else if (key === 'example' || key === 'examples' || key === 'xml') {
        continue;
      } else {
        const resolved = walk(value, depth);
        out[key] = resolved === TRUNCATED ? {} : resolved;
      }
    }
    if (Array.isArray(out.required) && out.properties) {
      out.required = out.required.filter((r) => r in out.properties);
    }
    return out;
  };

  const result = walk(schema, 0);
  return result === TRUNCATED ? {} : result;
}
