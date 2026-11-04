import fs from 'node:fs';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { isPostmanCollection, postmanToOpenApi } from './postman-converter.js';

export const SPEC_EXTENSIONS = ['.json', '.yaml', '.yml'];

/** Parse a local JSON or YAML file. */
export function parseSpecFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return path.extname(file).toLowerCase() === '.json' ? JSON.parse(text) : parseYaml(text);
}

/** Parse a local spec; Postman collections are converted to OpenAPI 3.0. */
export function readSpecFile(file) {
  const doc = parseSpecFile(file);
  return isPostmanCollection(doc)
    ? { doc: postmanToOpenApi(doc), format: 'postman', raw: doc }
    : { doc, format: 'openapi', raw: doc };
}
