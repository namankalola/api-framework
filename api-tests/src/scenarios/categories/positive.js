import { extractId } from '../resources.js';
import { refOf, successStatuses, expectationsFor } from '../context.js';

const MAX_ENUM_VALUES = 6;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

/** Compare as instants when both are ISO timestamps ("…Z" vs "….000+00:00"). */
const normalise = (value) =>
  typeof value === 'string' && ISO_DATE.test(value) ? new Date(value).toISOString() : value;

/** Assert that every scalar field we sent comes back unchanged (fields the API omits are ignored). */
function expectPersisted(expect, sent, received, label) {
  const differences = Object.entries(sent ?? {})
    .filter(([k, v]) => (v === null || typeof v !== 'object') && received && k in received)
    .filter(([k, v]) => normalise(v) !== normalise(received[k]))
    .map(([k, v]) => `${k}: sent ${JSON.stringify(v)}, got ${JSON.stringify(received[k])}`);
  expect(differences, `${label}: returned fields differ from what was sent`).toEqual([]);
}

function enumCases(op, schema) {
  const cases = [];
  const bodyEnums = Object.entries(schema?.properties ?? {}).filter(([, p]) => Array.isArray(p.enum));
  for (const [field, prop] of bodyEnums) {
    for (const value of prop.enum.slice(0, MAX_ENUM_VALUES)) {
      cases.push({
        id: `enum-body-${field}-${value}`,
        title: `accepts ${field}="${value}"`,
        async run(ctx) {
          const res = await ctx.send(await ctx.request({ mutate: (b) => ({ ...b, [field]: value }) }));
          ctx.expect(res).toHaveStatus(ctx.success);
        },
      });
    }
  }
  for (const param of op.parameters.filter((p) => p.in === 'query' && Array.isArray(p.schema?.enum))) {
    for (const value of param.schema.enum.slice(0, MAX_ENUM_VALUES)) {
      cases.push({
        id: `enum-query-${param.name}-${value}`,
        title: `accepts query ${param.name}=${value}`,
        async run(ctx) {
          const res = await ctx.send(await ctx.request({ query: { [param.name]: value } }));
          ctx.expect(res).toHaveStatus(ctx.success);
        },
      });
    }
  }
  return cases;
}

function lifecycleCase(group, config) {
  const { create, read, update, remove, idParam } = group;
  const steps = ['create', read && 'read', update && 'update', remove && 'delete'].filter(Boolean).join(' → ');
  return {
    id: 'crud-lifecycle',
    title: `resource lifecycle: ${steps}`,
    async run(ctx) {
      const { api, data, resources, expect } = ctx;
      const exp = expectationsFor(config, create.service);
      const parentPath = await resources.pathParams(create);

      const body = create.requestBody?.schema ? data.build(refOf(create)) : undefined;
      const created = await api.call(refOf(create), { path: parentPath, body, validate: false });
      expect(created).toHaveStatus(successStatuses(create, exp));
      expect(created).toMatchSchema();
      const id = extractId(idParam, created.body, body);
      expect(id, `create response has no value for {${idParam}}`).toBeDefined();
      const path = { ...parentPath, [idParam]: id };

      if (read) {
        const fetched = await api.call(refOf(read), { path, validate: false });
        expect(fetched).toHaveStatus(successStatuses(read, exp));
        expect(fetched).toMatchSchema();
        expectPersisted(expect, body, fetched.body, 'read after create');
      }

      if (update) {
        const idKey = Object.keys(created.body ?? {}).find((k) => created.body[k] === id) ?? 'id';
        const changes = update.requestBody?.schema ? data.build(refOf(update)) : undefined;
        const updateBody = changes && typeof changes === 'object' ? { ...changes, [idKey]: id } : changes;
        const updated = await api.call(refOf(update), { path, body: updateBody, validate: false });
        expect(updated).toHaveStatus(successStatuses(update, exp));
        if (read) {
          const fetched = await api.call(refOf(read), { path, validate: false });
          expectPersisted(expect, updateBody, fetched.body, 'read after update');
        }
      }

      if (remove) {
        const removed = await api.call(refOf(remove), { path, validate: false, cleanup: false });
        expect(removed).toHaveStatus(successStatuses(remove, exp));
        if (read) expect(await api.call(refOf(read), { path, validate: false })).toHaveStatus(exp.notFound);
      }
    },
  };
}

/** Valid requests succeed: all fields, required-only, every enum value, optional params, full CRUD flow. */
export function plan({ operations, requestSchema, registry, config }) {
  return operations.map((op) => {
    const schema = requestSchema(op);
    const cases = [
      {
        id: 'happy-path',
        title: 'succeeds with a valid request (all fields)',
        async run(ctx) {
          const res = await ctx.send(await ctx.request());
          ctx.expect(res).toHaveStatus(ctx.success);
          ctx.expect(res).toMatchSchema();
        },
      },
    ];

    const required = new Set(schema?.required ?? []);
    if (schema?.properties && Object.keys(schema.properties).some((k) => !required.has(k))) {
      cases.push({
        id: 'required-fields-only',
        title: 'succeeds with only the required fields',
        async run(ctx) {
          const res = await ctx.send(await ctx.request({ optional: false }));
          ctx.expect(res).toHaveStatus(ctx.success);
          ctx.expect(res).toMatchSchema();
        },
      });
    }

    if (op.parameters.some((p) => p.in === 'query' && !p.required)) {
      cases.push({
        id: 'all-optional-params',
        title: 'succeeds with every optional query parameter',
        async run(ctx) {
          const optional = ctx.data.params(ctx.ref, {}, { includeOptional: true }).query;
          const res = await ctx.send(await ctx.request({ query: optional }));
          ctx.expect(res).toHaveStatus(ctx.success);
        },
      });
    }

    cases.push(...enumCases(op, schema));

    const group = registry.resourceGroups(op.service).find((g) => g.create === op && (g.read || g.remove));
    if (group) cases.push(lifecycleCase(group, config));
    return { op, cases };
  });
}
