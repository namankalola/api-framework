import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../config/paths.js';
import { env } from '../../config/env-helpers.js';
import { readSpecFile, SPEC_EXTENSIONS } from './spec-file.js';

/** "orders-api.postman_collection.json" -> "orders-api" */
export function serviceNameFor(file) {
  return path
    .basename(file)
    .replace(/\.(json|ya?ml)$/i, '')
    .replace(/\.(postman_collection|openapi|swagger|oas)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "orders-api" -> "ORDERS_API" (prefix for the service's env vars) */
export const envPrefixFor = (serviceName) => serviceName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

/** Base URL from the spec: OpenAPI 3 `servers` (absolute only, variables filled) or Swagger 2 host. */
export function baseUrlFromSpec(doc) {
  const server = doc.servers?.find((s) => /^https?:\/\//.test(s.url));
  if (server) {
    return server.url
      .replace(/\{([^}]+)\}/g, (_, name) => server.variables?.[name]?.default ?? name)
      .replace(/\/$/, '');
  }
  if (doc.swagger === '2.0' && doc.host) {
    const scheme = doc.schemes?.includes('https') ? 'https' : (doc.schemes?.[0] ?? 'https');
    return `${scheme}://${doc.host}${doc.basePath ?? ''}`.replace(/\/$/, '');
  }
  return undefined;
}

/**
 * Auth config from env vars, falling back to the spec's first security scheme.
 * Returns { auth, missing } where `missing` lists env vars needed to enable auth.
 */
export function inferAuth(doc, prefix) {
  const v = (name) => env(`${prefix}_${name}`);
  const explicit = v('AUTH_TYPE');
  const schemes = doc.components?.securitySchemes ?? doc.securityDefinitions ?? {};
  const typeOfScheme = (s) =>
    s?.type === 'apiKey'
      ? 'apiKey'
      : s?.type === 'basic' || s?.scheme === 'basic'
        ? 'basic'
        : s?.scheme === 'bearer'
          ? 'bearer'
          : s?.type === 'oauth2' && (s.flows?.clientCredentials || s.flow === 'application')
            ? 'oauth2'
            : null; // e.g. OAuth2 implicit/authorization-code need a browser: not automatable

  // Prefer the globally required scheme, else the first one that can be automated.
  const preferred = Object.keys(doc.security?.[0] ?? {})[0];
  const ordered = [schemes[preferred], ...Object.values(schemes)].filter(Boolean);
  const scheme = ordered.find(typeOfScheme);
  const type = explicit ?? typeOfScheme(scheme) ?? 'none';

  const candidates = {
    none: [{ type: 'none' }, []],
    apiKey: [
      {
        type: 'apiKey',
        name: v('API_KEY_NAME') ?? scheme?.name ?? 'X-API-Key',
        in: v('API_KEY_IN') ?? scheme?.in ?? 'header',
        value: v('API_KEY'),
      },
      ['API_KEY'],
    ],
    basic: [{ type: 'basic', username: v('USERNAME'), password: v('PASSWORD') }, ['USERNAME', 'PASSWORD']],
    bearer: [{ type: 'bearer', token: v('TOKEN') }, ['TOKEN']],
    oauth2: [
      {
        type: 'oauth2',
        grantType: v('GRANT_TYPE') ?? 'client_credentials',
        tokenUrl: v('TOKEN_URL') ?? scheme?.flows?.clientCredentials?.tokenUrl ?? scheme?.tokenUrl,
        clientId: v('CLIENT_ID'),
        clientSecret: v('CLIENT_SECRET'),
        scope: v('SCOPE'),
      },
      ['CLIENT_ID', 'CLIENT_SECRET'],
    ],
    cookie: [
      { type: 'cookie', login: { path: v('LOGIN_PATH'), body: { username: v('USERNAME'), password: v('PASSWORD') } } },
      ['LOGIN_PATH', 'USERNAME', 'PASSWORD'],
    ],
  };
  const [auth, required] = candidates[type] ?? candidates.none;
  const missing = required.filter((name) => !v(name)).map((name) => `${prefix}_${name}`);
  return { auth, missing };
}

/**
 * Turn every spec file in the discovery folder that no configured service points at into a service.
 * Base URL: <PREFIX>_BASE_URL, else the spec's servers/host. Auth: <PREFIX>_AUTH_TYPE + secrets,
 * else inferred from the spec's security schemes (disabled until its secrets are set).
 */
export function discoverServices(config) {
  const { enabled, dir } = config.discovery ?? {};
  const folder = path.resolve(ROOT, dir ?? 'specs');
  if (!enabled || !fs.existsSync(folder)) return { services: {}, warnings: [] };

  const claimed = new Set(
    Object.values(config.services)
      .filter((svc) => !/^https?:/.test(svc.spec))
      .map((svc) => path.resolve(ROOT, svc.spec)),
  );
  const services = {};
  const warnings = [];

  for (const fileName of fs.readdirSync(folder).sort()) {
    const file = path.join(folder, fileName);
    if (!SPEC_EXTENSIONS.includes(path.extname(fileName).toLowerCase()) || claimed.has(file)) continue;

    let name = serviceNameFor(fileName);
    while (config.services[name] || services[name]) name = `${name}-2`;
    const prefix = envPrefixFor(name);

    let parsed;
    try {
      parsed = readSpecFile(file);
    } catch (error) {
      warnings.push(`specs/${fileName}: could not be parsed (${error.message}); skipped`);
      continue;
    }
    if (!parsed.doc?.paths && !parsed.doc?.openapi && !parsed.doc?.swagger) continue; // not an API definition

    const baseURL = env(`${prefix}_BASE_URL`) ?? baseUrlFromSpec(parsed.doc);
    if (!baseURL) {
      warnings.push(
        `specs/${fileName}: no absolute server URL in the file; set ${prefix}_BASE_URL to enable "${name}"`,
      );
      continue;
    }
    const { auth, missing } = inferAuth(parsed.doc, prefix);
    if (missing.length) {
      warnings.push(
        `service "${name}": ${auth.type} auth disabled until ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} set`,
      );
    }

    services[name] = {
      spec: path.relative(ROOT, file).replace(/\\/g, '/'),
      baseURL,
      headers: { Accept: 'application/json' },
      auth: missing.length ? { type: 'none' } : auth,
      discovered: true,
    };
  }
  return { services, warnings };
}
