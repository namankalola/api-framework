import { test } from '@playwright/test';
import { expect } from '../expect.js';
import { attachExchange, buildExchangeRecord } from './request-logger.js';
import { resolveTemplate } from '../utils/object-path.js';
import { extractId } from '../scenarios/resources.js';
import { fillPath } from '../utils/url.js';

/**
 * The `api` fixture. Call operations by operationId, or make raw requests by path.
 *
 *   await api.call('addPet', { body })
 *   await api.call('getPetById', { path: { petId: 1 } })
 *   await api.as('anonymous').call('getInventory')
 *   await api.get('/pet/findByStatus', { query: { status: 'sold' } })
 */
export class Api {
  constructor({ framework, sessions, cleanup, testInfo, profile = 'default', service }) {
    this.deps = { framework, sessions, cleanup, testInfo };
    this.profile = profile;
    this.serviceName = service ?? framework.config.defaultService;
  }

  /** Same API, different auth profile from config (`authProfiles`). */
  as(profile) {
    return new Api({ ...this.deps, profile, service: this.serviceName });
  }

  /** Same API, different service (for raw path requests in multi-service setups). */
  service(name) {
    return new Api({ ...this.deps, profile: this.profile, service: name });
  }

  /**
   * Call an OpenAPI operation.
   * @param {string} ref operationId, or "service:operationId" when ids clash across specs
   * @param {object} [options]
   * @param {object} [options.path]        path params
   * @param {object} [options.query]       query params
   * @param {object} [options.headers]
   * @param {*}      [options.body]
   * @param {string} [options.contentType] defaults to the spec's request content type (JSON preferred)
   * @param {boolean}[options.validate]    soft-assert the response schema (default from config)
   * @param {boolean}[options.cleanup]     delete what this call creates after the test (default true)
   * @param {number} [options.timeoutMs]
   */
  async call(ref, options = {}) {
    const operation = this.deps.framework.registry.get(ref);
    return this.#send(operation.service, operation, {
      ...options,
      method: operation.method,
      path: fillPath(operation.path, options.path, operation.id),
      pathParams: options.path,
      contentType: options.contentType ?? operation.requestBody?.contentType,
    });
  }

  /** Raw request by path. If the path matches a spec operation, it is still schema-validated. */
  async request(method, path, options = {}) {
    const upper = method.toUpperCase();
    const operation = this.deps.framework.registry.match(this.serviceName, upper, path);
    return this.#send(this.serviceName, operation, {
      ...options,
      method: upper,
      path,
      contentType: options.contentType ?? operation?.requestBody?.contentType ?? 'application/json',
    });
  }

  get(path, options) {
    return this.request('GET', path, options);
  }
  post(path, options) {
    return this.request('POST', path, options);
  }
  put(path, options) {
    return this.request('PUT', path, options);
  }
  patch(path, options) {
    return this.request('PATCH', path, options);
  }
  delete(path, options) {
    return this.request('DELETE', path, options);
  }

  async #send(
    serviceName,
    operation,
    { method, path, pathParams, query, headers, body, contentType, timeoutMs, validate, cleanup = true },
  ) {
    const { framework, sessions, testInfo } = this.deps;
    const { config } = framework;
    const label = `${operation ? `${operation.id}: ` : ''}${method} ${path}${this.profile === 'default' ? '' : ` [as ${this.profile}]`}`;

    const response = await test.step(
      label,
      async () => {
        const client = await sessions.client(serviceName, this.profile);
        const { request, response: res } = await client.send({
          method,
          path,
          query,
          headers: Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k, String(v)])),
          body,
          contentType,
          timeoutMs,
        });
        res.operation = operation;
        if (config.logging.attachToReport) {
          const record = buildExchangeRecord({ ...request, operationId: operation?.id }, res, config.logging);
          await attachExchange(testInfo, `${method} ${path} → ${res.status} (${res.durationMs} ms)`, record);
        }
        return res;
      },
      { box: true },
    );

    if (operation && (validate ?? config.validation.autoValidateResponses)) {
      expect.soft(response, 'response matches the OpenAPI schema').toMatchSchema();
    }
    if (operation && cleanup && response.ok) this.#registerCleanup(operation, response, { pathParams, body });
    return response;
  }

  /** Cleanup rule from config, else inferred: POST /x/... is undone by DELETE /x/.../{id}. */
  #cleanupRule(operation, response, { pathParams = {}, body }) {
    const { config, registry } = this.deps.framework;
    const rule = config.services[operation.service]?.cleanup?.[operation.id];
    if (rule) {
      return {
        operation: rule.operation,
        path: resolveTemplate(rule.path ?? {}, response.body),
        query: resolveTemplate(rule.query ?? {}, response.body),
      };
    }
    const group = registry.resourceGroups(operation.service).find((g) => g.create.id === operation.id && g.remove);
    if (!group) return null;
    return {
      operation: group.remove.id,
      path: { ...pathParams, [group.idParam]: extractId(group.idParam, response.body, body) },
      query: {},
    };
  }

  #registerCleanup(operation, response, request) {
    const rule = this.#cleanupRule(operation, response, request);
    if (!rule) return;
    const { path, query } = rule;
    if ([...Object.values(path), ...Object.values(query)].some((v) => v === undefined || v === null)) return;

    const target = `${operation.service}:${rule.operation}`;
    this.deps.cleanup.add(`${rule.operation} ${JSON.stringify({ ...path, ...query })}`, async () => {
      const res = await this.call(target, { path, query, validate: false, cleanup: false });
      // 404 means the test already deleted it.
      if (!res.ok && res.status !== 404) throw new Error(`${rule.operation} returned ${res.status}`);
    });
  }
}
