import { findLeaks, INJECTION_PAYLOADS, PRIVILEGED_FIELDS, SECURITY_HEADERS_HTTPS } from '../payloads.js';
import { matchesOperation, refOf } from '../context.js';

const typeOf = (schema) => [schema?.type].flat().find((t) => t && t !== 'null');
const stringFields = (schema) =>
  Object.entries(schema?.properties ?? {})
    .filter(([, p]) => typeOf(p) === 'string' && !p.enum && !p.format)
    .map(([k]) => k);

/** Common assertions for any attack: no crash, no leaked internals, no reflected script, no injected header. */
function expectSafe(ctx, res, payload) {
  ctx.expect(res.status, `server error (${res.status}) on malicious input`).toBeLessThan(500);
  // An API may legitimately echo what we sent; only scan the rest of the response.
  const leaks = findLeaks(payload ? res.text.split(payload).join('') : res.text);
  ctx.expect(leaks, `response leaks internals: ${leaks.join(', ')}\n${res.text?.slice(0, 300)}`).toEqual([]);
  if (/html/i.test(res.headers['content-type'] ?? '') && payload) {
    ctx.expect(res.text.includes(payload), 'payload reflected unescaped in an HTML response').toBe(false);
  }
  ctx.expect(res.headers['x-injected-header'], 'CRLF injection reached the response headers').toBeUndefined();
}

function operationCases(op, { requestSchema, config }) {
  const cases = [];
  const schema = requestSchema(op);
  const security = config.suites.security;
  const authType = config.services[op.service]?.auth?.type ?? 'none';

  if (op.requiresAuth) {
    cases.push({
      id: 'auth-required',
      title: 'rejects requests without credentials',
      async run(ctx) {
        const request = await ctx.request();
        const res = await ctx.api.as('$none').call(ctx.ref, { ...request, validate: false });
        ctx.expect(res).toHaveStatus(ctx.exp.unauthorized);
      },
    });
    if (authType !== 'none' && authType !== 'cookie') {
      cases.push({
        id: 'invalid-credentials',
        title: 'rejects invalid credentials',
        async run(ctx) {
          const request = await ctx.request();
          const res = await ctx.api.as('$invalid').call(ctx.ref, { ...request, validate: false });
          ctx.expect(res).toHaveStatus(ctx.exp.unauthorized);
        },
      });
    }
  }

  const bodyStrings = stringFields(schema);
  const queryStrings = op.parameters
    .filter((p) => p.in === 'query' && typeOf(p.schema) === 'string' && !p.schema.enum)
    .map((p) => p.name);
  const pathStrings = op.parameters
    .filter((p) => p.in === 'path' && typeOf(p.schema) === 'string' && !p.schema.format)
    .map((p) => p.name);
  if (security.injection && bodyStrings.length + queryStrings.length + pathStrings.length > 0) {
    for (const [family, payload] of Object.entries(INJECTION_PAYLOADS)) {
      cases.push({
        id: `injection-${family}`,
        title: `handles ${family} payloads safely (${[...bodyStrings, ...queryStrings, ...pathStrings].join(', ')})`,
        async run(ctx) {
          const request = await ctx.request({
            mutate: (b) => ({ ...b, ...Object.fromEntries(bodyStrings.map((f) => [f, payload])) }),
          });
          for (const q of queryStrings) request.query[q] = payload;
          for (const p of pathStrings) request.path[p] = payload;
          expectSafe(ctx, await ctx.send(request, { cleanup: true }), payload);
        },
      });
    }
  }

  if (
    schema?.properties &&
    ['POST', 'PUT', 'PATCH'].includes(op.method) &&
    /json/i.test(op.requestBody?.contentType ?? '')
  ) {
    cases.push({
      id: 'mass-assignment',
      title: 'ignores privileged fields the client must not set',
      async run(ctx) {
        const extra = Object.fromEntries(Object.entries(PRIVILEGED_FIELDS).filter(([k]) => !(k in schema.properties)));
        const res = await ctx.send(await ctx.request({ mutate: (b) => ({ ...b, ...extra }) }));
        ctx.expect(res.status).toBeLessThan(500);
        if (res.ok && res.body && typeof res.body === 'object') {
          const accepted = Object.keys(extra).filter((k) => JSON.stringify(res.body[k]) === JSON.stringify(extra[k]));
          ctx.expect(accepted, 'privileged fields were accepted and stored').toEqual([]);
        }
      },
    });
  }

  if (op.requestBody && /json/i.test(op.requestBody.contentType ?? '')) {
    cases.push({
      id: 'error-leakage',
      title: 'error responses do not leak internals',
      async run(ctx) {
        const res = await ctx.send(await ctx.request({ body: '{"unterminated": ' }));
        expectSafe(ctx, res);
      },
    });
  }

  if (op.method === 'GET') {
    cases.push({
      id: 'sensitive-data',
      title: 'response does not expose sensitive fields',
      async run(ctx) {
        const res = await ctx.send(await ctx.request());
        const keys = [];
        const walk = (node) => {
          if (Array.isArray(node)) node.slice(0, 50).forEach(walk);
          else if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
              if (security.sensitiveFields.some((f) => f.toLowerCase() === k.toLowerCase()) && v) keys.push(k);
              walk(v);
            }
          }
        };
        walk(res.body);
        ctx.expect([...new Set(keys)], 'sensitive fields returned to the client').toEqual([]);
      },
    });
  }

  if (security.idor && /\{[^}]+\}$/.test(op.path) && ['GET', 'PUT', 'PATCH', 'DELETE'].includes(op.method)) {
    cases.push({
      id: 'idor',
      title: `"${security.idor.attacker}" cannot access a resource owned by "${security.idor.owner}"`,
      async run(ctx) {
        const request = await ctx.request();
        const res = await ctx.api
          .as(security.idor.attacker)
          .call(ctx.ref, { ...request, validate: false, cleanup: false });
        ctx.expect(res).toHaveStatus(ctx.exp.forbidden);
      },
    });
  }

  for (const rule of security.roleChecks.filter(
    (r) => (!r.service || r.service === op.service) && matchesOperation(op, r.operations),
  )) {
    cases.push({
      id: `role-${rule.profile}`,
      title: `profile "${rule.profile}" is denied`,
      async run(ctx) {
        const request = await ctx.request();
        const res = await ctx.api.as(rule.profile).call(ctx.ref, { ...request, validate: false, cleanup: false });
        ctx.expect(res).toHaveStatus(rule.expect ?? ctx.exp.forbidden);
      },
    });
  }
  return cases;
}

function serviceCases(service, { config, operations, requestSchema }) {
  const { baseURL } = config.services[service];
  const security = config.suites.security;
  const probe = operations.find((op) => op.service === service && op.method === 'GET' && !op.path.includes('{'));
  const firstJsonPost = operations.find(
    (op) => op.service === service && op.method === 'POST' && /json/i.test(op.requestBody?.contentType ?? ''),
  );
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseURL);
  const cases = [];

  if (!local) {
    cases.push({
      id: 'https-only',
      title: 'base URL uses HTTPS',
      async run(ctx) {
        ctx.expect(baseURL.startsWith('https://'), `${baseURL} is not HTTPS`).toBe(true);
      },
    });
  }

  if (probe) {
    cases.push(
      {
        id: 'security-headers',
        title: 'responses carry security headers',
        async run(ctx) {
          const res = await ctx.api.call(refOf(probe), { ...ctx.data.params(refOf(probe)), validate: false });
          const required = {
            ...security.requiredHeaders,
            ...(baseURL.startsWith('https://') && !local ? SECURITY_HEADERS_HTTPS : {}),
          };
          const problems = Object.entries(required)
            .filter(([name, want]) => {
              const got = res.headers[name.toLowerCase()];
              return (
                got === undefined ||
                (want instanceof RegExp ? !want.test(got) : got.toLowerCase() !== String(want).toLowerCase())
              );
            })
            .map(([name, want]) => `${name} should be ${want}, got ${res.headers[name.toLowerCase()] ?? '(missing)'}`);
          const banner = res.headers.server ?? res.headers['x-powered-by'];
          if (banner && /\d/.test(banner)) problems.push(`server version disclosed: "${banner}"`);
          ctx.expect(problems).toEqual([]);
        },
      },
      {
        id: 'cors-policy',
        title: 'CORS does not trust arbitrary origins with credentials',
        async run(ctx) {
          const evil = 'https://evil.example';
          const res = await ctx.api.call(refOf(probe), {
            ...ctx.data.params(refOf(probe)),
            headers: { Origin: evil },
            validate: false,
          });
          const origin = res.headers['access-control-allow-origin'];
          const credentials = res.headers['access-control-allow-credentials'] === 'true';
          ctx
            .expect(credentials && (origin === evil || origin === '*'), `allows ${origin} with credentials`)
            .toBe(false);
        },
      },
      {
        id: 'trace-disabled',
        title: 'TRACE is disabled',
        async run(ctx) {
          const res = await ctx.api.service(service).request('TRACE', probe.path, { validate: false });
          ctx.expect(res.status, 'TRACE answered with 200 (cross-site tracing)').not.toBe(200);
        },
      },
    );
  }

  cases.push({
    id: 'unknown-endpoint',
    title: 'unknown endpoints return 404 without leaking internals',
    async run(ctx) {
      const res = await ctx.api.service(service).request('GET', `/__does-not-exist-${Date.now()}`, { validate: false });
      ctx.expect(res).toHaveStatus(ctx.exp.notFound);
      expectSafe(ctx, res);
    },
  });

  if (firstJsonPost) {
    // Pad a real string field so the server has to process the value, not just drop an unknown key.
    const field = stringFields(requestSchema(firstJsonPost))[0] ?? 'padding';
    cases.push({
      id: 'oversized-payload',
      title: `survives a ${security.oversizedPayloadKb} KB payload`,
      async run(ctx) {
        const body = {
          ...ctx.data.build(refOf(firstJsonPost)),
          [field]: 'x'.repeat(security.oversizedPayloadKb * 1024),
        };
        const res = await ctx.api.call(refOf(firstJsonPost), { body, validate: false });
        ctx.expect(res.status, 'server error on a large payload').toBeLessThan(500);
      },
    });
  }

  if (security.rateLimit.enabled && security.rateLimit.operation) {
    cases.push({
      id: 'rate-limit',
      title: `rate limit kicks in within ${security.rateLimit.requests} rapid requests`,
      async run(ctx) {
        const ref = security.rateLimit.operation.includes(':')
          ? security.rateLimit.operation
          : `${service}:${security.rateLimit.operation}`;
        const params = ctx.data.params(ref);
        const statuses = await Promise.all(
          Array.from({ length: security.rateLimit.requests }, () =>
            ctx.api.call(ref, { ...params, validate: false }).then((r) => r.status),
          ),
        );
        ctx.expect(statuses, 'no 429 Too Many Requests').toContain(429);
      },
    });
  }
  return cases;
}

/** Authentication, authorisation, injection, data exposure and transport checks. */
export function plan(planCtx) {
  const services = [...new Set(planCtx.operations.map((op) => op.service))];
  return [
    ...services.map((service) => ({ service, opId: '_service', cases: serviceCases(service, planCtx) })),
    ...planCtx.operations.map((op) => ({ op, cases: operationCases(op, planCtx) })),
  ];
}
