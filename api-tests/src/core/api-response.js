import { getByPath } from '../utils/object-path.js';

/** Fully-read HTTP response. Safe to use after the request context is disposed. */
export class ApiResponse {
  constructor({ method, url, status, statusText, headers, body, text, durationMs, attempts, operation, service }) {
    Object.assign(this, { method, url, status, statusText, headers, body, text, durationMs, attempts });
    this.operation = operation ?? null;
    this.service = service;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  /** Read a field from the body: res.get('$.items[0].id'). */
  get(path) {
    return getByPath(this.body, path);
  }

  toJSON() {
    const { method, url, status, durationMs, body } = this;
    return { method, url, status, durationMs, body };
  }
}
