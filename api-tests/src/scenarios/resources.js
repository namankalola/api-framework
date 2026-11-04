import { getByPath } from '../utils/object-path.js';
import { FrameworkError } from '../utils/errors.js';

/** A test's preconditions could not be set up (e.g. the create call failed). Suites skip on this. */
export class PreconditionError extends FrameworkError {}

const camelWords = (name) =>
  name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_-]+/);

/**
 * Find the value for a path param in a create response (or the request that created it).
 * "petId" is looked up as petId, id, pet_id, uuid, key, then the same names under data/result.
 */
export function extractId(paramName, ...sources) {
  const words = camelWords(paramName);
  const candidates = [
    paramName,
    'id',
    words.join('_'),
    words.at(-1) === 'id' ? null : words.at(-1),
    'uuid',
    'key',
    'name',
  ]
    .filter(Boolean)
    .flatMap((key) => [key, `data.${key}`, `result.${key}`]);
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of candidates) {
      const value = getByPath(source, key);
      if (value !== undefined && value !== null && typeof value !== 'object') return value;
    }
  }
  return undefined;
}

/**
 * Resolves {pathParams} for an operation by creating the parent resources through the API
 * (POST /pet for /pet/{petId}, nested resources in order). Created resources are cleaned up
 * by the `api` fixture. One resolver per test; results are cached within the test.
 */
export class ResourceResolver {
  constructor({ registry, config, api, data }) {
    Object.assign(this, { registry, config, api, data });
    this.cache = new Map();
  }

  #fixedValue(operation, name) {
    const fixed = this.config.resources?.pathParams ?? {};
    return (
      fixed[`${operation.service}:${operation.id}.${name}`] ?? fixed[`${operation.service}:${name}`] ?? fixed[name]
    );
  }

  /** Fail fast when an API does not persist what it creates, instead of cascading into many failures. */
  async #verifyReadable(creator, path, name) {
    if (this.config.resources?.verifyCreated === false) return;
    const read = this.registry.resourceGroups(creator.service).find((g) => g.create === creator)?.read;
    if (!read) return;
    const response = await this.api.call(`${read.service}:${read.id}`, { path, validate: false, cleanup: false });
    if (!response.ok) {
      throw new PreconditionError(
        `setup: ${creator.id} returned {${name}}=${path[name]} but ${read.id} answers ${response.status}; ` +
          `the API may not persist writes, so set config.resources.pathParams["${creator.service}:${name}"] to an existing id`,
      );
    }
  }

  /** Create one resource via `creator` (operation or ref) and return { body, response }. */
  async create(creator, path = {}, overrides = {}) {
    if (typeof creator === 'string') creator = this.registry.get(creator);
    const body = creator.requestBody?.schema
      ? this.data.build(`${creator.service}:${creator.id}`, overrides)
      : undefined;
    const response = await this.api.call(`${creator.service}:${creator.id}`, { path, body, validate: false });
    if (!response.ok) {
      throw new PreconditionError(
        `setup: ${creator.id} returned ${response.status}, so a resource could not be created`,
      );
    }
    return { body, response };
  }

  /**
   * @param {object|string} operation  registry operation, operationId or "service:operationId"
   * @param {object} overrides         values to use instead of resolving
   * @returns {Promise<object>} path params, e.g. { petId: 123 }
   */
  async pathParams(operation, overrides = {}) {
    if (typeof operation === 'string') operation = this.registry.get(operation);
    const names = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => name);
    const resolved = {};
    for (const name of names) {
      if (overrides[name] !== undefined) {
        resolved[name] = overrides[name];
        continue;
      }
      const fixed = this.#fixedValue(operation, name);
      if (fixed !== undefined) {
        resolved[name] = fixed;
        continue;
      }
      const creator = this.registry.creatorFor(operation, name);
      if (!creator) {
        throw new PreconditionError(
          `no POST endpoint creates {${name}} for ${operation.method} ${operation.path}; set config.resources.pathParams.${name}`,
        );
      }
      const cacheKey = `${creator.service}:${creator.id}:${JSON.stringify(resolved)}`;
      if (!this.cache.has(cacheKey)) {
        const { body, response } = await this.create(creator, { ...resolved });
        const id = extractId(name, response.body, body);
        if (id === undefined) {
          throw new PreconditionError(`setup: could not find {${name}} in the ${creator.id} response`);
        }
        await this.#verifyReadable(creator, { ...resolved, [name]: id }, name);
        this.cache.set(cacheKey, id);
      }
      resolved[name] = this.cache.get(cacheKey);
    }
    return resolved;
  }
}
