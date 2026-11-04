const WRONG_TYPE_VALUE = {
  string: 12345,
  integer: 'not-a-number',
  number: 'not-a-number',
  boolean: 'not-a-boolean',
  array: 'not-an-array',
  object: 'not-an-object',
};

const typeOf = (schema) => [schema?.type].flat().find((t) => t && t !== 'null');

/**
 * Derive invalid payloads from a resolved object schema and one valid body.
 * Covers the top-level fields: missing required, wrong type, null, enum and length/range violations.
 *
 * @returns {{ name: string, rule: string, field: string|null, body: object }[]}
 */
export function deriveNegativeCases(schema, validBody) {
  if (!schema || typeOf(schema) !== 'object' || !schema.properties) return [];
  const cases = [];
  const required = new Set(schema.required ?? []);
  const withField = (field, value) => ({ ...validBody, [field]: value });

  if (required.size) cases.push({ name: 'empty body', rule: 'required', field: null, body: {} });

  for (const [field, prop] of Object.entries(schema.properties)) {
    const type = typeOf(prop);
    const label = (rule) => `${field}: ${rule}`;

    if (required.has(field)) {
      const { [field]: _omitted, ...rest } = validBody;
      cases.push({ name: label('missing required field'), rule: 'required', field, body: rest });
      if (!prop.nullable && ![prop.type].flat().includes('null')) {
        cases.push({ name: label('null for required field'), rule: 'nullable', field, body: withField(field, null) });
      }
    }
    if (type && WRONG_TYPE_VALUE[type] !== undefined) {
      cases.push({
        name: label(`wrong type (expected ${type})`),
        rule: 'type',
        field,
        body: withField(field, WRONG_TYPE_VALUE[type]),
      });
    }
    if (prop.enum) {
      cases.push({ name: label('value outside enum'), rule: 'enum', field, body: withField(field, '__not_in_enum__') });
    }
    if (type === 'string' && prop.maxLength !== undefined) {
      cases.push({
        name: label(`longer than maxLength ${prop.maxLength}`),
        rule: 'maxLength',
        field,
        body: withField(field, 'x'.repeat(prop.maxLength + 1)),
      });
    }
    if (type === 'string' && prop.minLength > 0) {
      cases.push({
        name: label(`shorter than minLength ${prop.minLength}`),
        rule: 'minLength',
        field,
        body: withField(field, 'x'.repeat(prop.minLength - 1)),
      });
    }
    if ((type === 'integer' || type === 'number') && prop.minimum !== undefined) {
      cases.push({
        name: label(`below minimum ${prop.minimum}`),
        rule: 'minimum',
        field,
        body: withField(field, prop.minimum - 1),
      });
    }
    if ((type === 'integer' || type === 'number') && prop.maximum !== undefined) {
      cases.push({
        name: label(`above maximum ${prop.maximum}`),
        rule: 'maximum',
        field,
        body: withField(field, prop.maximum + 1),
      });
    }
  }
  return cases;
}
