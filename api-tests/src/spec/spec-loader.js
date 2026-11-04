import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { CACHE_DIR, ROOT } from '../../config/paths.js';
import { SpecError } from '../utils/errors.js';
import { readSpecFile } from './spec-file.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('spec');
const SPEC_CACHE_DIR = path.join(CACHE_DIR, 'specs');
const memo = new Map();

const isUrl = (source) => /^https?:\/\//i.test(source);

function cacheFile(serviceName, source) {
  // Local specs are keyed by content so edits invalidate the cache automatically.
  // Remote specs are keyed by URL; refresh them with `npm run spec:refresh`.
  const fingerprint = isUrl(source) ? source : fs.readFileSync(path.resolve(ROOT, source));
  const hash = crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 12);
  return path.join(SPEC_CACHE_DIR, `${serviceName}-${hash}.json`);
}

async function bundle(serviceName, source, { validate }) {
  const location = isUrl(source) ? source : path.resolve(ROOT, source);
  const started = Date.now();
  try {
    // Postman collections are converted to OpenAPI first; real specs are bundled from disk so
    // external $ref files resolve. bundle() keeps internal $refs, so circular schemas stay small.
    const local = isUrl(source) ? null : readSpecFile(location);
    const doc = await SwaggerParser.bundle(local?.format === 'postman' ? local.doc : location);
    if (validate) await SwaggerParser.validate(structuredClone(doc));
    log.info(`Bundled "${serviceName}" spec from ${source} in ${Date.now() - started} ms`);
    return doc;
  } catch (error) {
    throw new SpecError(`Failed to load OpenAPI spec for service "${serviceName}" from ${source}: ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Load the bundled OpenAPI document for a service. Results are memoised per process and
 * cached on disk, so large specs are parsed once per run instead of once per worker.
 */
export function loadSpec(serviceName, { spec: source }, { validate = false, refresh = false } = {}) {
  if (!refresh && memo.has(serviceName)) return memo.get(serviceName);

  const promise = (async () => {
    const file = cacheFile(serviceName, source);
    if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));

    const doc = await bundle(serviceName, source, { validate });
    fs.mkdirSync(SPEC_CACHE_DIR, { recursive: true });
    for (const stale of fs.readdirSync(SPEC_CACHE_DIR).filter((f) => f.startsWith(`${serviceName}-`))) {
      fs.rmSync(path.join(SPEC_CACHE_DIR, stale), { force: true });
    }
    fs.writeFileSync(file, JSON.stringify(doc));
    return doc;
  })();

  memo.set(serviceName, promise);
  promise.catch(() => memo.delete(serviceName));
  return promise;
}

export function clearSpecCache() {
  memo.clear();
  fs.rmSync(SPEC_CACHE_DIR, { recursive: true, force: true });
}
