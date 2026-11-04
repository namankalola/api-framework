import { AuthError } from '../utils/errors.js';
import { getByPath } from '../utils/object-path.js';
import { joinUrl } from '../utils/url.js';

/**
 * Every strategy implements the same small interface:
 *   setup()   one-time work per worker (login, token fetch)
 *   headers() headers added to every request
 *   query()   query params added to every request
 *   refresh() optional; called once when a request returns 401
 */
class AuthStrategy {
  constructor(options, { context, baseURL, label }) {
    this.options = options;
    this.context = context;
    this.baseURL = baseURL;
    this.label = label;
  }

  require(...keys) {
    const missing = keys.filter((k) => this.options[k] === undefined || this.options[k] === '');
    if (missing.length) {
      throw new AuthError(
        `${this.label}: auth type "${this.options.type}" needs ${missing.join(', ')}. Set them in config or .env`,
      );
    }
  }

  async setup() {}
  async headers() {
    return {};
  }
  query() {
    return {};
  }
  get canRefresh() {
    return false;
  }

  /** Perform a login request with the unauthenticated context. */
  async login({ path, method = 'POST', body, form, headers }) {
    const response = await this.context.fetch(joinUrl(this.baseURL, path), { method, data: body, form, headers });
    if (!response.ok()) {
      throw new AuthError(
        `${this.label}: login ${method} ${path} failed with ${response.status()}: ${await response.text()}`,
      );
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

class NoAuth extends AuthStrategy {}

class ApiKeyAuth extends AuthStrategy {
  async setup() {
    this.require('name', 'value');
  }
  async headers() {
    return this.options.in === 'query' ? {} : { [this.options.name]: this.options.value };
  }
  query() {
    return this.options.in === 'query' ? { [this.options.name]: this.options.value } : {};
  }
}

class BasicAuth extends AuthStrategy {
  async setup() {
    this.require('username', 'password');
  }
  async headers() {
    const token = Buffer.from(`${this.options.username}:${this.options.password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
}

/** Static token, or a token obtained from a login endpoint (`login.tokenPath` in the response). */
class BearerAuth extends AuthStrategy {
  async setup() {
    if (this.options.token) {
      this.token = this.options.token;
      return;
    }
    if (!this.options.login) this.require('token');
    await this.refresh();
  }
  get canRefresh() {
    return Boolean(this.options.login);
  }
  async refresh() {
    const { tokenPath = '$.token', ...login } = this.options.login;
    const body = await this.login(login);
    this.token = getByPath(body, tokenPath);
    if (!this.token) throw new AuthError(`${this.label}: no token at "${tokenPath}" in login response`);
  }
  async headers() {
    const { header = 'Authorization', scheme = 'Bearer' } = this.options;
    return { [header]: scheme ? `${scheme} ${this.token}` : this.token };
  }
}

/** OAuth2 client_credentials or password grant, with expiry-aware caching. */
class OAuth2Auth extends AuthStrategy {
  async setup() {
    this.require('tokenUrl', 'clientId');
    if (this.options.grantType === 'password') this.require('username', 'password');
    await this.refresh();
  }
  get canRefresh() {
    return true;
  }
  async refresh() {
    this.inflight ??= this.#fetchToken().finally(() => (this.inflight = undefined));
    await this.inflight;
  }
  async #fetchToken() {
    const {
      grantType = 'client_credentials',
      tokenUrl,
      clientId,
      clientSecret,
      scope,
      audience,
      username,
      password,
    } = this.options;
    const form = { grant_type: grantType, scope, audience, username, password };
    const headers = {};
    if (this.options.clientAuth === 'basic') {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret ?? ''}`).toString('base64')}`;
    } else {
      Object.assign(form, { client_id: clientId, client_secret: clientSecret });
    }
    for (const key of Object.keys(form)) if (form[key] === undefined) delete form[key];

    const body = await this.login({ path: tokenUrl, form, headers });
    if (!body?.access_token) throw new AuthError(`${this.label}: token response has no access_token`);
    this.token = body.access_token;
    // Refresh 30 s early to avoid using a token that expires mid-request.
    this.expiresAt = body.expires_in ? Date.now() + (Number(body.expires_in) - 30) * 1000 : Infinity;
  }
  async headers() {
    if (Date.now() >= this.expiresAt) await this.refresh();
    return { Authorization: `Bearer ${this.token}` };
  }
}

/** Session cookie: log in once; the request context stores and resends the cookies. */
class CookieAuth extends AuthStrategy {
  async setup() {
    if (!this.options.login?.path) throw new AuthError(`${this.label}: cookie auth needs login.path`);
    await this.refresh();
  }
  get canRefresh() {
    return true;
  }
  async refresh() {
    await this.login(this.options.login);
  }
}

const STRATEGIES = {
  none: NoAuth,
  apiKey: ApiKeyAuth,
  basic: BasicAuth,
  bearer: BearerAuth,
  oauth2: OAuth2Auth,
  cookie: CookieAuth,
};

export const AUTH_TYPES = Object.keys(STRATEGIES);

export function createAuth(options = { type: 'none' }, deps) {
  const Strategy = STRATEGIES[options.type];
  if (!Strategy) throw new AuthError(`${deps.label}: unknown auth type "${options.type}"`);
  return new Strategy(options, deps);
}
