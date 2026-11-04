import { framework } from '../framework.js';

const preview = (res, max = 600) => {
  const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2);
  return text && text.length > max ? `${text.slice(0, max)}…` : (text ?? '');
};

const describe = (res) => `${res.method} ${res.url}${res.operation ? ` (${res.operation.id})` : ''}`;

/** Custom matchers for ApiResponse objects. Registered through `expect.extend`. */
export const apiMatchers = {
  toHaveStatus(res, expected) {
    const allowed = [expected].flat();
    const pass = allowed.includes(res.status);
    return {
      name: 'toHaveStatus',
      pass,
      expected,
      actual: res.status,
      message: () =>
        `${describe(res)}\nExpected status ${this.isNot ? 'not ' : ''}${allowed.join(' or ')}, received ${res.status}\n\nResponse body:\n${preview(res)}`,
    };
  },

  /**
   * expect(res).toMatchSchema()          -> schema documented for res.operation + res.status
   * expect(res).toMatchSchema('Pet')     -> named component schema
   * expect(res).toMatchSchema({ ... })   -> inline JSON schema
   */
  toMatchSchema(res, schema) {
    const { validator, config } = framework();
    let result;
    if (schema === undefined) {
      if (!res.operation) {
        return {
          name: 'toMatchSchema',
          pass: false,
          message: () => `${describe(res)} was a raw call; pass a schema name or object to toMatchSchema()`,
        };
      }
      result = validator.validateResponse(res.operation, res.status, res.body);
      if (!result.checked) {
        return { name: 'toMatchSchema', pass: !this.isNot, message: () => `${describe(res)}: ${result.reason}` };
      }
    } else {
      result = validator.validate(res.service ?? config.defaultService, schema, res.body);
    }
    return {
      name: 'toMatchSchema',
      pass: result.valid,
      message: () =>
        result.valid
          ? `${describe(res)} matched the schema but was expected not to`
          : `${describe(res)} → ${res.status} does not match the OpenAPI schema:\n  - ${result.errors.join('\n  - ')}\n\nResponse body:\n${preview(res)}`,
    };
  },

  toRespondWithin(res, ms) {
    const pass = res.durationMs <= ms;
    return {
      name: 'toRespondWithin',
      pass,
      message: () =>
        `${describe(res)} took ${res.durationMs} ms; expected ${this.isNot ? 'more than' : 'at most'} ${ms} ms`,
    };
  },

  toHaveHeader(res, name, value) {
    const actual = res.headers[name.toLowerCase()];
    const pass =
      actual !== undefined &&
      (value === undefined || (value instanceof RegExp ? value.test(actual) : actual === value));
    return {
      name: 'toHaveHeader',
      pass,
      message: () =>
        `${describe(res)}: expected header "${name}"${value === undefined ? '' : ` = ${value}`}, received ${actual === undefined ? 'no such header' : `"${actual}"`}`,
    };
  },
};
