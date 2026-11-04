import { ApiResponse } from './api-response.js';
import { buildQuery, joinUrl } from '../utils/url.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function encodeBody(body, contentType) {
  if (body === undefined) return {};
  if (/x-www-form-urlencoded/i.test(contentType ?? '')) return { form: body };
  if (/multipart\/form-data/i.test(contentType ?? '')) return { multipart: body };
  if (!contentType || /json/i.test(contentType))
    return { data: typeof body === 'string' ? body : JSON.stringify(body) };
  return { data: body };
}

function parseBody(text, contentType) {
  if (!text) return null;
  if (/json/i.test(contentType ?? '') || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Sends HTTP requests for one service + auth profile over a Playwright APIRequestContext.
 * Handles base URL, auth headers, retries for idempotent calls, and one re-auth on 401.
 */
export class ApiClient {
  constructor({ serviceName, serviceConfig, http, context, auth }) {
    this.serviceName = serviceName;
    this.serviceConfig = serviceConfig;
    this.http = http;
    this.context = context;
    this.auth = auth;
  }

  /** Headers that will be sent, used for both the request and the report. */
  async #headers(extra, contentType, hasBody) {
    return {
      ...this.serviceConfig.headers,
      ...(await this.auth.headers()),
      ...(hasBody && contentType && !/multipart/i.test(contentType) ? { 'Content-Type': contentType } : {}),
      ...extra,
    };
  }

  /**
   * @param {object} req
   * @param {string} req.method
   * @param {string} req.path       path relative to the service base URL, or an absolute URL
   * @param {object} [req.query]
   * @param {object} [req.headers]
   * @param {*}      [req.body]
   * @param {string} [req.contentType]
   * @param {number} [req.timeoutMs]
   * @returns {Promise<{ request: object, response: ApiResponse }>}
   */
  async send({ method, path, query = {}, headers = {}, body, contentType, timeoutMs }) {
    const { retries, retryDelayMs, retryOnStatus, retryMethods } = this.http;
    const url = joinUrl(this.serviceConfig.baseURL, path) + buildQuery({ ...this.auth.query(), ...query });
    const canRetry = retryMethods.includes(method);
    let requestHeaders = await this.#headers(headers, contentType, body !== undefined);
    let reauthenticated = false;
    const started = Date.now();

    for (let attempt = 1; ; attempt += 1) {
      let raw;
      try {
        raw = await this.context.fetch(url, {
          method,
          headers: requestHeaders,
          timeout: timeoutMs ?? this.http.timeoutMs,
          failOnStatusCode: false,
          ...encodeBody(body, contentType),
        });
      } catch (error) {
        if (canRetry && attempt <= retries) {
          log.warn(`${method} ${url} failed (${error.message}); retry ${attempt}/${retries}`);
          await sleep(retryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        error.message = `${method} ${url} failed after ${attempt} attempt(s): ${error.message}`;
        throw error;
      }

      const status = raw.status();
      if (status === 401 && this.auth.canRefresh && !reauthenticated) {
        reauthenticated = true;
        log.info(`${method} ${url} returned 401; refreshing credentials and retrying once`);
        await this.auth.refresh();
        requestHeaders = await this.#headers(headers, contentType, body !== undefined);
        continue;
      }
      if (canRetry && attempt <= retries && retryOnStatus.includes(status)) {
        log.warn(`${method} ${url} returned ${status}; retry ${attempt}/${retries}`);
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      const responseHeaders = raw.headers();
      const text = await raw.text();
      const response = new ApiResponse({
        method,
        url,
        status,
        statusText: raw.statusText(),
        headers: responseHeaders,
        body: parseBody(text, responseHeaders['content-type']),
        text,
        durationMs: Date.now() - started,
        attempts: attempt,
        service: this.serviceName,
      });
      await raw.dispose();
      log.debug(`${method} ${url} -> ${status} (${response.durationMs} ms)`);
      return { request: { method, url, headers: requestHeaders, body, contentType }, response };
    }
  }
}
