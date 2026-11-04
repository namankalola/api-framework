const UNICODE_SAMPLE = 'Zoë Łukasz 名前 مرحبا 🚀';
const SPECIAL_CHARS = `!@#$%^&*()_+-=[]{};':"\\|,.<>/?~\``;

const typeOf = (schema) => [schema?.type].flat().find((t) => t && t !== 'null');
const constrained = (schema) => schema.enum || schema.const !== undefined || schema.format || schema.pattern;

/**
 * Variants for one input. Modes:
 *   valid   on the documented boundary -> must succeed
 *   invalid just past the boundary     -> must be rejected (4xx)
 *   robust  unusual but undocumented   -> must not crash (no 5xx)
 */
function variants(name, schema, { longStringLength, largeArrayLength }) {
  const out = [];
  const add = (id, title, mode, value) => out.push({ id: `${name}-${id}`, title: `${name}: ${title}`, mode, value });
  const type = typeOf(schema);

  if (type === 'string') {
    if (schema.maxLength !== undefined)
      add('at-max-length', `exactly maxLength (${schema.maxLength})`, 'valid', () => 'a'.repeat(schema.maxLength));
    if (schema.minLength > 0)
      add('at-min-length', `exactly minLength (${schema.minLength})`, 'valid', () => 'a'.repeat(schema.minLength));
    if (!constrained(schema)) {
      if (!(schema.minLength > 0)) add('empty', 'empty string', 'robust', () => '');
      if (schema.maxLength === undefined)
        add('very-long', `${longStringLength} characters`, 'robust', () => 'x'.repeat(longStringLength));
      if (schema.maxLength === undefined || schema.maxLength >= UNICODE_SAMPLE.length)
        add('unicode', 'unicode and emoji', 'robust', () => UNICODE_SAMPLE);
      add('whitespace', 'whitespace only', 'robust', () => '   ');
      if (schema.maxLength === undefined || schema.maxLength >= SPECIAL_CHARS.length)
        add('special-chars', 'special characters', 'robust', () => SPECIAL_CHARS);
    }
  }

  if (type === 'integer' || type === 'number') {
    if (schema.minimum !== undefined)
      add('at-minimum', `exactly minimum (${schema.minimum})`, 'valid', () => schema.minimum);
    if (schema.maximum !== undefined)
      add('at-maximum', `exactly maximum (${schema.maximum})`, 'valid', () => schema.maximum);
    if (!schema.enum) {
      if (schema.minimum === undefined) {
        add('zero', 'zero', 'robust', () => 0);
        add('negative', 'negative number', 'robust', () => -1);
      }
      if (schema.maximum === undefined)
        add('max-safe-integer', 'Number.MAX_SAFE_INTEGER', 'robust', () => Number.MAX_SAFE_INTEGER);
      if (type === 'integer') add('decimal', 'decimal value for an integer', 'invalid', () => 1.5);
    }
  }

  if (type === 'array') {
    const fill = (base, n) => Array.from({ length: n }, (_, i) => base[i % Math.max(base.length, 1)]);
    if (schema.minItems > 0)
      add('at-min-items', `exactly minItems (${schema.minItems})`, 'valid', (v) => fill(v, schema.minItems));
    if (schema.maxItems !== undefined) {
      add('at-max-items', `exactly maxItems (${schema.maxItems})`, 'valid', (v) => fill(v, schema.maxItems));
      add('over-max-items', `maxItems + 1 (${schema.maxItems + 1})`, 'invalid', (v) => fill(v, schema.maxItems + 1));
    }
    if (!(schema.minItems > 0)) add('empty-array', 'empty array', 'robust', () => []);
    if (schema.maxItems === undefined)
      add('large-array', `${largeArrayLength} items`, 'robust', (v) => fill(v, largeArrayLength));
  }
  return out;
}

function assertMode(ctx, res, mode) {
  if (mode === 'valid') ctx.expect(res).toHaveStatus(ctx.success);
  else if (mode === 'invalid') ctx.expect(res).toHaveStatus(ctx.exp.badRequest);
  else ctx.expect(res.status, `server error for an unusual but plausible value: ${res.status}`).toBeLessThan(500);
}

/** Edge values for every top-level body field and query parameter. */
export function plan({ operations, requestSchema, config }) {
  const options = config.suites.boundary;
  return operations.map((op) => {
    const cases = [];
    const schema = requestSchema(op);

    for (const [field, prop] of Object.entries(schema?.properties ?? {})) {
      for (const v of variants(field, prop, options)) {
        cases.push({
          id: `body-${v.id}`,
          title: `body ${v.title}`,
          async run(ctx) {
            const request = await ctx.request({ mutate: (b) => ({ ...b, [field]: v.value(b[field] ?? []) }) });
            assertMode(ctx, await ctx.send(request), v.mode);
          },
        });
      }
    }

    for (const param of op.parameters.filter((p) => p.in === 'query')) {
      for (const v of variants(param.name, param.schema ?? {}, options)) {
        cases.push({
          id: `query-${v.id}`,
          title: `query ${v.title}`,
          async run(ctx) {
            const request = await ctx.request();
            request.query[param.name] = v.value([].concat(request.query[param.name] ?? []));
            assertMode(ctx, await ctx.send(request), v.mode);
          },
        });
      }
    }
    return { op, cases };
  });
}
