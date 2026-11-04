import { ApiClient } from './api-client.js';
import { createAuth } from '../auth/strategies.js';
import { ConfigError } from '../utils/errors.js';

/** Same auth type as the service, with credentials that must be rejected. */
function invalidCredentials(auth = { type: 'none' }) {
  switch (auth.type) {
    case 'apiKey':
      return { ...auth, value: 'invalid-api-key-0000' };
    case 'basic':
      return { ...auth, password: 'wrong-password-0000' };
    case 'bearer':
    case 'oauth2':
      return { type: 'bearer', token: 'invalid.token.0000' };
    default:
      return { type: 'none' };
  }
}

/**
 * Auth options for a profile. Built-in profiles used by the security suite:
 *   $none     no credentials
 *   $invalid  the service's auth type with wrong credentials
 */
function resolveProfile(serviceConfig, profile) {
  if (profile === 'default') return serviceConfig.auth ?? { type: 'none' };
  if (profile === '$none') return { type: 'none' };
  if (profile === '$invalid') return invalidCredentials(serviceConfig.auth);
  return serviceConfig.authProfiles?.[profile];
}

/**
 * Worker-scoped pool of authenticated clients, one per service + auth profile.
 * Login / token fetch happens once per worker, not once per test.
 */
export class SessionManager {
  constructor({ playwright, config }) {
    this.playwright = playwright;
    this.config = config;
    this.clients = new Map();
    this.contexts = [];
  }

  client(serviceName, profile = 'default') {
    const key = `${serviceName}:${profile}`;
    if (!this.clients.has(key)) {
      const promise = this.#create(serviceName, profile);
      promise.catch(() => this.clients.delete(key)); // let the next test retry a failed login
      this.clients.set(key, promise);
    }
    return this.clients.get(key);
  }

  async #create(serviceName, profile) {
    const serviceConfig = this.config.services[serviceName];
    if (!serviceConfig) throw new ConfigError(`Unknown service "${serviceName}"`);
    const authOptions = resolveProfile(serviceConfig, profile);
    if (!authOptions) {
      const known = ['default', ...Object.keys(serviceConfig.authProfiles ?? {})].join(', ');
      throw new ConfigError(`Service "${serviceName}" has no auth profile "${profile}". Known: ${known}`);
    }

    const context = await this.playwright.request.newContext({
      ignoreHTTPSErrors: this.config.http.ignoreHTTPSErrors,
      timeout: this.config.http.timeoutMs,
    });
    this.contexts.push(context);
    const auth = createAuth(authOptions, {
      context,
      baseURL: serviceConfig.baseURL,
      label: `${serviceName}/${profile}`,
    });
    await auth.setup();
    return new ApiClient({ serviceName, serviceConfig, http: this.config.http, context, auth });
  }

  async dispose() {
    await Promise.allSettled(this.contexts.map((c) => c.dispose()));
    this.clients.clear();
    this.contexts = [];
  }
}
