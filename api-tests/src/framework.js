import config from '../config/index.js';
import { loadSpec } from './spec/spec-loader.js';
import { OperationRegistry } from './spec/operation-registry.js';
import { SchemaValidator } from './validation/schema-validator.js';

let pending;
let instance;

async function build({ validateSpec }) {
  const entries = await Promise.all(
    Object.entries(config.services).map(async ([name, service]) => [
      name,
      await loadSpec(name, service, { validate: validateSpec }),
    ]),
  );
  const registry = new OperationRegistry(Object.fromEntries(entries), config.defaultService);
  return { config, registry, validator: new SchemaValidator(registry) };
}

/** Load specs and build the registry once per process. */
export async function getFramework({ validateSpec = config.validation.validateSpecOnStartup } = {}) {
  pending ??= build({ validateSpec });
  instance = await pending;
  return instance;
}

/** Synchronous access for code (like expect matchers) that runs after fixtures have loaded it. */
export function framework() {
  if (!instance) throw new Error('Framework not initialised. Import `test` from src/fixtures/index.js.');
  return instance;
}
