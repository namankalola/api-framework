import { inferSchema } from './schema-inference.js';

/** True when a parsed JSON document is a Postman collection (v2.0 / v2.1). */
export const isPostmanCollection = (doc) =>
  Boolean(doc?.info && Array.isArray(doc.item) && (doc.info._postman_id || /getpostman/.test(doc.info.schema ?? '')));

const BASE_URL_VARS = ['baseUrl', 'baseURL', 'base_url', 'url', 'host', 'apiUrl', 'api_url'];

const tryJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const slug = (s) =>
  s.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, (c) => c.toLowerCase());

/** Flatten nested folders into [{ item, tags }]. */
function* walk(items, tags = []) {
  for (const item of items ?? []) {
    if (Array.isArray(item.item)) yield* walk(item.item, [...tags, item.name]);
    else if (item.request) yield { item, tags };
  }
}

/** Postman URL ("{{baseUrl}}/pets/:id?x=1" or object form) -> OpenAPI path "/pets/{id}". */
function toPath(url) {
  let segments;
  if (typeof url === 'string') {
    const withoutQuery = url.split('?')[0];
    const withoutHost = withoutQuery.replace(/^(https?:\/\/)?(\{\{[^}]+\}\}|[^/]+)/, '');
    segments = withoutHost.split('/').filter(Boolean);
  } else {
    segments = [url?.path ?? []].flat().filter(Boolean);
  }
  return `/${segments.map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s.replace(/^\{\{(.+)\}\}$/, '{$1}'))).join('/')}`;
}

function queryParams(url) {
  if (typeof url === 'object' && url?.query) return url.query.filter((q) => !q.disabled);
  if (typeof url === 'string' && url.includes('?')) {
    return [...new URLSearchParams(url.split('?')[1])].map(([key, value]) => ({ key, value }));
  }
  return [];
}

function scalarSchema(value) {
  if (value === undefined || value === '' || /^\{\{.+\}\}$/.test(value)) return { type: 'string' };
  return /^-?\d+$/.test(value)
    ? { type: 'integer' }
    : /^(true|false)$/.test(value)
      ? { type: 'boolean' }
      : { type: 'string' };
}

function requestBody(body) {
  if (!body) return undefined;
  if (body.mode === 'raw') {
    const parsed = tryJson((body.raw ?? '').replace(/\{\{[^}]+\}\}/g, '"x"'));
    const contentType = body.options?.raw?.language === 'xml' ? 'application/xml' : 'application/json';
    const schema = parsed === undefined ? { type: 'string' } : inferSchema(parsed);
    return { required: true, content: { [contentType]: { schema, ...(parsed !== undefined && { example: parsed }) } } };
  }
  if (body.mode === 'urlencoded' || body.mode === 'formdata') {
    const fields = (body[body.mode] ?? []).filter((f) => !f.disabled);
    const contentType = body.mode === 'urlencoded' ? 'application/x-www-form-urlencoded' : 'multipart/form-data';
    return {
      required: true,
      content: {
        [contentType]: {
          schema: {
            type: 'object',
            properties: Object.fromEntries(
              fields.map((f) => [
                f.key,
                f.type === 'file' ? { type: 'string', format: 'binary' } : scalarSchema(f.value),
              ]),
            ),
          },
        },
      },
    };
  }
  return undefined;
}

function responses(saved = []) {
  const result = {};
  for (const res of saved) {
    const status = String(res.code ?? 200);
    const parsed = tryJson(res.body ?? '');
    const description = res.status ?? res.name ?? 'Response';
    result[status] =
      parsed === undefined
        ? { description }
        : { description, content: { 'application/json': { schema: inferSchema(parsed), example: parsed } } };
  }
  return Object.keys(result).length ? result : { 200: { description: 'OK' } };
}

function securityScheme(auth) {
  if (!auth || auth.type === 'noauth') return null;
  const get = (key) => [auth[auth.type]].flat().find((e) => e?.key === key)?.value;
  if (auth.type === 'bearer') return { type: 'http', scheme: 'bearer' };
  if (auth.type === 'basic') return { type: 'http', scheme: 'basic' };
  if (auth.type === 'apikey') return { type: 'apiKey', name: get('key') ?? 'X-API-Key', in: get('in') ?? 'header' };
  if (auth.type === 'oauth2') {
    return {
      type: 'oauth2',
      flows: { clientCredentials: { tokenUrl: get('accessTokenUrl') ?? '/oauth/token', scopes: {} } },
    };
  }
  return null;
}

/** Resolve the base URL from collection variables or the first request's host. */
export function postmanBaseUrl(collection) {
  const vars = Object.fromEntries((collection.variable ?? []).map((v) => [v.key, v.value]));
  const fromVars = BASE_URL_VARS.map((k) => vars[k]).find((v) => /^https?:\/\//.test(v ?? ''));
  if (fromVars) return fromVars;
  for (const { item } of walk(collection.item)) {
    const raw = typeof item.request.url === 'string' ? item.request.url : item.request.url?.raw;
    const match = raw?.match(/^(https?:\/\/[^/?]+(?:\/api(?:\/v\d+)?)?)/);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Convert a Postman collection into an OpenAPI 3.0 document. Request and response schemas are
 * inferred from example bodies, so review the generated spec for optional fields and enums.
 */
export function postmanToOpenApi(collection) {
  const doc = {
    openapi: '3.0.3',
    info: {
      title: collection.info.name ?? 'Postman collection',
      version: '1.0.0',
      description: collection.info.description,
    },
    servers: postmanBaseUrl(collection) ? [{ url: postmanBaseUrl(collection) }] : [],
    paths: {},
    components: { securitySchemes: {} },
  };

  const collectionScheme = securityScheme(collection.auth);
  if (collectionScheme) {
    doc.components.securitySchemes.default = collectionScheme;
    doc.security = [{ default: [] }];
  }

  const usedIds = new Set();
  for (const { item, tags } of walk(collection.item)) {
    const { request } = item;
    const method = (request.method ?? 'GET').toLowerCase();
    const path = toPath(request.url);
    let operationId = slug(item.name) || `${method}${slug(path)}`;
    for (let i = 2; usedIds.has(operationId); i += 1) operationId = `${slug(item.name)}${i}`;
    usedIds.add(operationId);

    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => {
      const variable = [request.url?.variable ?? []].flat().find((v) => v.key === name);
      return { name, in: 'path', required: true, schema: scalarSchema(variable?.value) };
    });
    const query = queryParams(request.url).map((q) => ({
      name: q.key,
      in: 'query',
      required: false,
      schema: scalarSchema(q.value),
      description: q.description,
    }));
    const headers = (request.header ?? [])
      .filter((h) => !h.disabled && !/^(content-type|accept|authorization)$/i.test(h.key))
      .map((h) => ({ name: h.key, in: 'header', required: false, schema: { type: 'string' } }));

    const operation = {
      operationId,
      summary: item.name,
      tags: tags.length ? [tags.at(-1)] : undefined,
      parameters: [...pathParams, ...query, ...headers],
      requestBody: requestBody(request.body),
      responses: responses(item.response),
    };
    const scheme = securityScheme(request.auth);
    if (scheme) {
      doc.components.securitySchemes[operationId] = scheme;
      operation.security = [{ [operationId]: [] }];
    } else if (request.auth?.type === 'noauth') {
      operation.security = [];
    }

    doc.paths[path] ??= {};
    doc.paths[path][method] = JSON.parse(JSON.stringify(operation)); // drops undefined fields
  }
  unifyPathParamTypes(doc);
  return doc;
}

/** Requests without a sample value default {id} to string; reuse the type a sibling request revealed. */
function unifyPathParamTypes(doc) {
  for (const pathItem of Object.values(doc.paths)) {
    const ops = Object.values(pathItem);
    const typed = {};
    for (const p of ops.flatMap((op) => op.parameters ?? []).filter((p) => p.in === 'path')) {
      if (p.schema.type !== 'string') typed[p.name] ??= p.schema;
    }
    for (const p of ops.flatMap((op) => op.parameters ?? []).filter((p) => p.in === 'path' && typed[p.name])) {
      p.schema = typed[p.name];
    }
  }
}
