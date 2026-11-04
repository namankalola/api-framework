import './load-dotenv.js';
import { deepMerge } from '../src/utils/deep-merge.js';
import { ConfigError } from '../src/utils/errors.js';
import { AUTH_TYPES } from '../src/auth/strategies.js';
import { discoverServices } from '../src/spec/discovery.js';
import defaults from './default.js';
import dev from './env/dev.js';
import qa from './env/qa.js';
import stage from './env/stage.js';

// Register new environments here.
const ENVIRONMENTS = { dev, qa, stage };

export const TEST_ENV = process.env.TEST_ENV || 'dev';

function validate(config) {
  const problems = [];
  const services = Object.entries(config.services ?? {});
  if (services.length === 0) problems.push('services: at least one service is required');

  for (const [name, svc] of services) {
    if (!svc.spec) problems.push(`services.${name}.spec is required`);
    if (!svc.baseURL) problems.push(`services.${name}.baseURL is required (set it in config or env)`);
    const auths = { auth: svc.auth ?? { type: 'none' } };
    for (const [profile, auth] of Object.entries(svc.authProfiles ?? {})) auths[`authProfiles.${profile}`] = auth;
    for (const [key, auth] of Object.entries(auths)) {
      if (!AUTH_TYPES.includes(auth?.type)) {
        problems.push(`services.${name}.${key}.type "${auth?.type}" must be one of: ${AUTH_TYPES.join(', ')}`);
      }
    }
  }
  if (config.defaultService && !config.services?.[config.defaultService]) {
    problems.push(`defaultService "${config.defaultService}" is not defined in services`);
  }
  if (problems.length) {
    throw new ConfigError(`Invalid configuration for TEST_ENV=${TEST_ENV}:\n  - ${problems.join('\n  - ')}`);
  }
  return config;
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) if (value && typeof value === 'object') deepFreeze(value);
  return Object.freeze(obj);
}

function load() {
  const overrides = ENVIRONMENTS[TEST_ENV];
  if (!overrides) {
    throw new ConfigError(`Unknown TEST_ENV "${TEST_ENV}". Known: ${Object.keys(ENVIRONMENTS).join(', ')}`);
  }
  const merged = deepMerge(defaults, overrides);
  const { services, warnings } = discoverServices(merged);
  merged.services = { ...merged.services, ...services };
  merged.discoveryWarnings = warnings;
  return deepFreeze(validate(merged));
}

export const config = load();
export default config;
