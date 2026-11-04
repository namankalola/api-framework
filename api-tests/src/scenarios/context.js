import { test } from '@playwright/test';
import { expect } from '../expect.js';
import { findMatch, matchesGlob } from '../utils/glob.js';
import { resolveSchema } from '../spec/schema-resolver.js';
import { extractId } from './resources.js';

export const refOf = (op) => `${op.service}:${op.id}`;

export const expectationsFor = (config, service) => ({
  ...config.suites.expectations,
  ...config.services[service]?.expectations,
});

/** Reason if the test id matches a `suites.knownIssues` pattern. */
export function knownIssue(config, key) {
  const pattern = findMatch(key, Object.keys(config.suites.knownIssues ?? {}));
  return pattern ? config.suites.knownIssues[pattern] : undefined;
}

/** Documented 2xx codes for an operation, else the generic success list. */
export function successStatuses(op, expectations) {
  const documented = Object.keys(op.responses)
    .filter((s) => /^2\d\d$/.test(s))
    .map(Number);
  return documented.length ? documented : expectations.success;
}

export const matchesOperation = (op, patterns = []) =>
  patterns.some((p) => (p.includes(':') ? matchesGlob(refOf(op), p) : matchesGlob(op.id, p)));

/** Operations the generated suites cover, after config filters. */
export function selectOperations(registry, config) {
  const s = config.suites;
  return registry
    .list()
    .filter((op) => s.includeDeprecated || !op.deprecated)
    .filter((op) => !s.includeServices.length || findMatch(op.service, s.includeServices))
    .filter((op) => !s.includeTags.length || op.tags.some((t) => findMatch(t, s.includeTags)))
    .filter((op) => !s.includeOperations.length || matchesOperation(op, s.includeOperations))
    .filter((op) => !matchesOperation(op, s.excludeOperations));
}

/** Collection-time helpers shared by the category planners. */
export function createPlanContext(framework) {
  const { registry, config } = framework;
  const schemas = new Map();
  return {
    registry,
    config,
    operations: selectOperations(registry, config),
    /** Resolved request body schema (top level is what the planners mutate), or null. */
    requestSchema(op) {
      if (!schemas.has(refOf(op))) {
        const raw = op.requestBody?.schema;
        schemas.set(
          refOf(op),
          raw
            ? resolveSchema(registry.doc(op.service), raw, { maxDepth: config.data.maxRefDepth, direction: 'request' })
            : null,
        );
      }
      return schemas.get(refOf(op));
    },
    groupFor(op) {
      return (
        registry.resourceGroups(op.service).find((g) => [g.create, g.read, g.update, g.remove].includes(op)) ?? null
      );
    },
  };
}

const isJson = (op) => /json/i.test(op?.requestBody?.contentType ?? '');

/** Run-time helpers handed to every case. */
export function createCaseContext({ op, service, api, data, framework, resources, testInfo }) {
  const { registry, config } = framework;
  const exp = expectationsFor(config, op?.service ?? service);
  const ref = op ? refOf(op) : null;

  return {
    op,
    ref,
    service: op?.service ?? service,
    api,
    data,
    framework,
    config,
    resources,
    testInfo,
    exp,
    expect,
    success: op ? successStatuses(op, exp) : exp.success,
    isJson: isJson(op),
    skip: (reason) => test.skip(true, reason),

    /**
     * A valid request for the operation: path params resolved by creating resources,
     * required query/header params and a generated body. `mutate(body)` derives a variant.
     */
    async request({ optional = true, path = {}, query = {}, headers = {}, body, mutate, omitBody = false } = {}) {
      const resolvedPath = await resources.pathParams(op, path);
      const params = data.params(ref);
      let requestBody;
      if (op.requestBody?.schema && !omitBody) {
        requestBody = body ?? data.build(ref, {}, { optional });
        // PUT /pet-style updates carry the id in the body: point it at a real resource.
        const group = registry.resourceGroups(op.service).find((g) => g.update === op);
        if (
          body === undefined &&
          group &&
          !op.path.includes(`{${group.idParam}}`) &&
          requestBody &&
          typeof requestBody === 'object'
        ) {
          const parent = await resources.pathParams(group.create);
          const created = await resources.create(group.create, parent);
          const id = extractId(group.idParam, created.response.body, created.body);
          const idKey = Object.keys(created.response.body ?? {}).find((k) => created.response.body[k] === id) ?? 'id';
          requestBody = { ...requestBody, [idKey]: id };
        }
        if (mutate) requestBody = mutate(structuredClone(requestBody));
      }
      return {
        path: resolvedPath,
        query: { ...params.query, ...query },
        headers: { ...params.headers, ...headers },
        body: requestBody,
      };
    },

    /** Call the operation with a prepared request. Suites assert explicitly, so auto-validation is off. */
    send(request, options = {}) {
      return api.call(ref, { ...request, validate: false, ...options });
    },
  };
}
