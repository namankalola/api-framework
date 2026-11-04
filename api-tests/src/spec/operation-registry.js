import { deref, encodePointerToken, toPointer } from '../utils/json-pointer.js';
import { SpecError } from '../utils/errors.js';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const JSON_TYPE = /^application\/(.+\+)?json/i;

/** Prefer JSON, then whatever the spec lists first. */
export const pickContentType = (types) => types.find((t) => JSON_TYPE.test(t)) ?? types[0];

const fallbackOperationId = (method, path) =>
  `${method}_${path
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;

function collectParameters(doc, pathItem, operation) {
  const byKey = new Map();
  for (const raw of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const param = deref(doc, raw);
    byKey.set(`${param.in}:${param.name}`, param); // operation-level params override path-level ones
  }
  return [...byKey.values()];
}

/** OpenAPI 3.x request body. */
function requestBody3(doc, operation, basePointer) {
  if (!operation.requestBody) return null;
  const body = deref(doc, operation.requestBody);
  const contentTypes = Object.keys(body.content ?? {});
  const contentType = pickContentType(contentTypes);
  const pointerBase = operation.requestBody.$ref ?? `${basePointer}/requestBody`;
  return {
    required: Boolean(body.required),
    contentTypes,
    contentType,
    schema: body.content?.[contentType]?.schema,
    pointer: `${pointerBase}/content/${encodePointerToken(contentType)}/schema`,
  };
}

/** Swagger 2.0 request body (an `in: body` or `in: formData` parameter). */
function requestBody2(doc, operation, parameters, basePointer) {
  const consumes = operation.consumes ?? doc.consumes ?? ['application/json'];
  const bodyIndex = (operation.parameters ?? []).findIndex((p) => deref(doc, p).in === 'body');
  if (bodyIndex >= 0) {
    const param = deref(doc, operation.parameters[bodyIndex]);
    return {
      required: Boolean(param.required),
      contentTypes: consumes,
      contentType: pickContentType(consumes),
      schema: param.schema,
      pointer: `${basePointer}/parameters/${bodyIndex}/schema`,
    };
  }
  const formParams = parameters.filter((p) => p.in === 'formData');
  if (!formParams.length) return null;
  return {
    required: formParams.some((p) => p.required),
    contentTypes: consumes,
    contentType: consumes.includes('multipart/form-data') ? 'multipart/form-data' : 'application/x-www-form-urlencoded',
    schema: {
      type: 'object',
      required: formParams.filter((p) => p.required).map((p) => p.name),
      properties: Object.fromEntries(formParams.map(({ name, in: _in, required: _r, ...schema }) => [name, schema])),
    },
    pointer: null,
  };
}

function responses(doc, operation, basePointer, isSwagger2) {
  const result = {};
  for (const [status, raw] of Object.entries(operation.responses ?? {})) {
    const response = deref(doc, raw);
    const pointerBase = raw.$ref ?? `${basePointer}/responses/${status}`;
    if (isSwagger2) {
      result[status] = response.schema
        ? { contentType: 'application/json', schema: response.schema, pointer: `${pointerBase}/schema` }
        : { contentType: null, schema: null, pointer: null };
      continue;
    }
    const contentType = pickContentType(Object.keys(response.content ?? {}));
    const schema = contentType ? response.content[contentType].schema : null;
    result[status] = {
      contentType: contentType ?? null,
      schema: schema ?? null,
      pointer: schema ? `${pointerBase}/content/${encodePointerToken(contentType)}/schema` : null,
    };
  }
  return result;
}

function indexService(serviceName, doc) {
  const isSwagger2 = doc.swagger === '2.0';
  const ops = [];
  for (const [path, rawPathItem] of Object.entries(doc.paths ?? {})) {
    const pathItem = deref(doc, rawPathItem);
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const basePointer = toPointer(['paths', path, method]);
      const parameters = collectParameters(doc, pathItem, operation);
      const security = operation.security ?? doc.security ?? [];
      ops.push({
        id: operation.operationId ?? fallbackOperationId(method, path),
        service: serviceName,
        method: method.toUpperCase(),
        path,
        tags: operation.tags ?? [],
        summary: operation.summary ?? '',
        deprecated: Boolean(operation.deprecated),
        parameters: parameters
          .filter((p) => ['path', 'query', 'header', 'cookie'].includes(p.in))
          .map((p) => ({ ...p, schema: p.schema ?? { type: p.type, enum: p.enum, items: p.items, format: p.format } })),
        requestBody: isSwagger2
          ? requestBody2(doc, operation, parameters, basePointer)
          : requestBody3(doc, operation, basePointer),
        responses: responses(doc, operation, basePointer, isSwagger2),
        security,
        // An empty requirement object ({}) means "anonymous access allowed".
        requiresAuth: security.length > 0 && !security.some((req) => Object.keys(req).length === 0),
      });
    }
  }
  return ops;
}

/**
 * Index of every operation across every configured service, addressable by
 * "operationId" or "service:operationId".
 */
export class OperationRegistry {
  /** @param {Record<string, object>} docs bundled OpenAPI documents keyed by service name */
  constructor(docs, defaultService) {
    this.docs = docs;
    this.defaultService = defaultService;
    this.byQualifiedId = new Map();
    this.byId = new Map();

    for (const [serviceName, doc] of Object.entries(docs)) {
      for (const op of indexService(serviceName, doc)) {
        this.byQualifiedId.set(`${serviceName}:${op.id}`, op);
        this.byId.set(op.id, [...(this.byId.get(op.id) ?? []), op]);
      }
    }
  }

  get(ref) {
    if (ref.includes(':')) {
      const op = this.byQualifiedId.get(ref);
      if (!op) throw new SpecError(`Unknown operation "${ref}".${this.#suggest(ref.split(':')[1])}`);
      return op;
    }
    const matches = this.byId.get(ref) ?? [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const preferred = matches.find((op) => op.service === this.defaultService);
      if (preferred) return preferred;
      throw new SpecError(
        `Operation "${ref}" exists in several services (${matches.map((m) => m.service).join(', ')}). Use "service:${ref}".`,
      );
    }
    throw new SpecError(`Unknown operation "${ref}".${this.#suggest(ref)}`);
  }

  /** List operations, optionally filtered by service, tag, or method. */
  list({ service, tag, method } = {}) {
    return [...this.byQualifiedId.values()].filter(
      (op) =>
        (!service || op.service === service) &&
        (!tag || op.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) &&
        (!method || op.method === method.toUpperCase()),
    );
  }

  /**
   * Infer REST resources from path shapes: POST /pet + GET|PUT|DELETE /pet/{petId} form a group
   * { collectionPath, idParam, create, read, update, remove }. Used for CRUD flows, resolving
   * {petId} by creating a pet, and default cleanup.
   */
  resourceGroups(serviceName) {
    this.groups ??= new Map();
    if (this.groups.has(serviceName)) return this.groups.get(serviceName);

    const ops = this.list({ service: serviceName });
    const groups = [];
    for (const create of ops.filter((op) => op.method === 'POST')) {
      const itemPattern = new RegExp(
        `^${create.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '\\{[^}]+\\}')}/\\{([^}]+)\\}$`,
      );
      const itemOps = ops.filter((op) => itemPattern.test(op.path));
      if (!itemOps.length) continue;
      const idParam = itemOps[0].path.match(itemPattern)[1];
      const on = (method) => itemOps.find((op) => op.method === method);
      groups.push({
        collectionPath: create.path,
        idParam,
        create,
        read: on('GET') ?? null,
        update: on('PUT') ?? on('PATCH') ?? ops.find((op) => op.method === 'PUT' && op.path === create.path) ?? null,
        remove: on('DELETE') ?? null,
      });
    }
    this.groups.set(serviceName, groups);
    return groups;
  }

  /** The POST that creates the resource identified by `{paramName}` in `operation.path`, if any. */
  creatorFor(operation, paramName) {
    const index = operation.path.indexOf(`/{${paramName}}`);
    if (index < 0) return null;
    const collectionPath = operation.path.slice(0, index) || '/';
    return this.resourceGroups(operation.service).find((g) => g.collectionPath === collectionPath)?.create ?? null;
  }

  /** Find the operation whose path template matches a concrete request path, e.g. GET /pet/42. */
  match(serviceName, method, requestPath) {
    const pathname = requestPath.split('?')[0].replace(/\/+$/, '') || '/';
    return (
      this.list({ service: serviceName, method }).find((op) => {
        this.patterns ??= new Map();
        const key = `${op.service}:${op.path}`;
        if (!this.patterns.has(key)) {
          const source = op.path
            .replace(/\/+$/, '')
            .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
            .replace(/\\?\{[^}]+\\?\}/g, '[^/]+');
          this.patterns.set(key, new RegExp(`^${source || '/'}$`));
        }
        return this.patterns.get(key).test(pathname);
      }) ?? null
    );
  }

  doc(serviceName) {
    return this.docs[serviceName];
  }

  #suggest(id) {
    const needle = id.toLowerCase();
    const close = [...this.byId.keys()].filter(
      (k) => k.toLowerCase().includes(needle) || needle.includes(k.toLowerCase()),
    );
    return close.length
      ? ` Did you mean: ${close.slice(0, 5).join(', ')}?`
      : ' Run `npm run gen -- --list` to see all operations.';
  }
}
