import { maskFields, maskHeaders, maskUrl } from '../utils/mask.js';

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

function truncate(value, max) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text && text.length > max ? `${text.slice(0, max)}\n… [${text.length - max} more chars]` : text;
}

function toCurl({ method, url, headers, body, contentType }) {
  const parts = [`curl -X ${method} ${shellQuote(url)}`];
  for (const [k, v] of Object.entries(headers)) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  if (body !== undefined) {
    const payload = /x-www-form-urlencoded/i.test(contentType ?? '')
      ? new URLSearchParams(body).toString()
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
    parts.push(`--data-raw ${shellQuote(payload)}`);
  }
  return parts.join(' \\\n  ');
}

/** Build a secret-masked record of one request/response exchange for the report. */
export function buildExchangeRecord(request, response, logging) {
  const url = maskUrl(request.url, logging.maskFields);
  const headers = maskHeaders(request.headers, logging.maskHeaders);
  const requestBody = request.body === undefined ? undefined : maskFields(request.body, logging.maskFields);
  return {
    operation: request.operationId ?? null,
    request: { method: request.method, url, headers, body: requestBody },
    response: response && {
      status: response.status,
      statusText: response.statusText,
      durationMs: response.durationMs,
      attempts: response.attempts,
      headers: maskHeaders(response.headers, logging.maskHeaders),
      body: truncate(maskFields(response.body, logging.maskFields), logging.maxBodyChars),
    },
    curl: toCurl({ method: request.method, url, headers, body: requestBody, contentType: request.contentType }),
  };
}

/** Attach the exchange to the Playwright HTML report. No-op outside a test (e.g. worker-level login). */
export async function attachExchange(testInfo, title, record) {
  if (!testInfo) return;
  await testInfo.attach(title, { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
}
