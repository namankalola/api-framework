import { randomUUID } from 'node:crypto';
import { deriveNegativeCases } from '../../data/negative-cases.js';

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A value of the right type that cannot exist on the server. */
const missingValue = (schema, data) =>
  schema?.format === 'uuid'
    ? randomUUID()
    : ['integer', 'number'].includes(schema?.type)
      ? data.uniqueId() * 10 + 7
      : data.unique('does-not-exist');

const invalidPathValue = (schema) =>
  schema?.format === 'uuid'
    ? 'not-a-uuid'
    : ['integer', 'number'].includes(schema?.type)
      ? 'not-a-number'
      : schema?.type === 'boolean'
        ? 'not-a-boolean'
        : null;

const METHODS = ['DELETE', 'PUT', 'PATCH', 'POST', 'GET'];

/** Invalid requests are rejected with 4xx: bad bodies, missing params, bad ids, wrong media type and method. */
export function plan({ operations, requestSchema, registry }) {
  const pathsSeen = new Set();

  return operations.map((op) => {
    const schema = requestSchema(op);
    const cases = [];

    if (schema && op.requestBody) {
      // Body variants derived from the schema; the valid body itself is generated at run time.
      for (const c of deriveNegativeCases(schema, {})) {
        cases.push({
          id: `body-${slug(c.name)}`,
          title: `rejects body: ${c.name}`,
          async run(ctx) {
            const request = await ctx.request({
              mutate: (body) => {
                if (c.rule === 'required' && c.field === null) return {};
                if (c.rule === 'required') {
                  const { [c.field]: _omit, ...rest } = body;
                  return rest;
                }
                return { ...body, [c.field]: c.body[c.field] };
              },
            });
            ctx.expect(await ctx.send(request)).toHaveStatus(ctx.exp.badRequest);
          },
        });
      }
    }

    if (op.requestBody && /json/i.test(op.requestBody.contentType ?? '')) {
      cases.push(
        {
          id: 'malformed-json',
          title: 'rejects malformed JSON',
          async run(ctx) {
            const request = await ctx.request({ body: '{"unterminated": ' });
            ctx.expect(await ctx.send(request)).toHaveStatus(ctx.exp.badRequest);
          },
        },
        {
          id: 'unsupported-media-type',
          title: 'rejects an unsupported Content-Type',
          async run(ctx) {
            const request = await ctx.request();
            const res = await ctx.send(
              { ...request, body: JSON.stringify(request.body) },
              { contentType: 'text/plain' },
            );
            ctx.expect(res).toHaveStatus(ctx.exp.unsupportedMediaType);
          },
        },
      );
    }

    if (op.requestBody?.required) {
      cases.push({
        id: 'missing-body',
        title: 'rejects a request without the required body',
        async run(ctx) {
          ctx.expect(await ctx.send(await ctx.request({ omitBody: true }))).toHaveStatus(ctx.exp.badRequest);
        },
      });
    }

    for (const param of op.parameters.filter((p) => p.required && (p.in === 'query' || p.in === 'header'))) {
      cases.push({
        id: `missing-${param.in}-${slug(param.name)}`,
        title: `rejects a request without required ${param.in} "${param.name}"`,
        async run(ctx) {
          const request = await ctx.request();
          const bucket = param.in === 'query' ? request.query : request.headers;
          delete bucket[param.name];
          ctx.expect(await ctx.send(request)).toHaveStatus(ctx.exp.badRequest);
        },
      });
    }

    for (const param of op.parameters.filter((p) => p.in === 'path')) {
      const bad = invalidPathValue(param.schema);
      if (bad === null) continue;
      cases.push({
        id: `invalid-path-${slug(param.name)}`,
        title: `rejects a malformed {${param.name}}`,
        async run(ctx) {
          const request = await ctx.request();
          request.path[param.name] = bad;
          ctx.expect(await ctx.send(request)).toHaveStatus([...ctx.exp.badRequest, ...ctx.exp.notFound]);
        },
      });
    }

    // Item operations (…/{id}) must return 404 for an id that does not exist.
    const lastParam = op.path.match(/\{([^}]+)\}$/)?.[1];
    if (lastParam && op.method !== 'POST') {
      const schemaOfParam = op.parameters.find((p) => p.in === 'path' && p.name === lastParam)?.schema;
      cases.push({
        id: 'not-found',
        title: `returns 404 for a {${lastParam}} that does not exist`,
        async run(ctx) {
          const request = await ctx.request({ path: { [lastParam]: missingValue(schemaOfParam, ctx.data) } });
          ctx.expect(await ctx.send(request)).toHaveStatus(ctx.exp.notFound);
        },
      });
    }

    // One "method not allowed" check per path.
    const key = `${op.service}:${op.path}`;
    if (!pathsSeen.has(key)) {
      pathsSeen.add(key);
      // Skip methods that another route would answer, e.g. DELETE /pet/findByStatus hits DELETE /pet/{petId}.
      const concrete = op.path.replace(/\{[^}]+\}/g, '1');
      const method = METHODS.find(
        (m) => !registry.match(op.service, m, concrete) && !registry.match(op.service, m, op.path),
      );
      if (method) {
        cases.push({
          id: `method-not-allowed-${method.toLowerCase()}`,
          title: `rejects ${method} on ${op.path}`,
          async run(ctx) {
            const res = await ctx.api
              .service(op.service)
              .request(method, concrete, { validate: false, cleanup: false });
            ctx.expect(res).toHaveStatus(ctx.exp.methodNotAllowed);
          },
        });
      }
    }

    return { op, cases };
  });
}
