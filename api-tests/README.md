# API Automation Framework

Config-driven API testing on **Playwright + JavaScript**. **Drop an OpenAPI/Swagger file or a Postman collection
into `specs/`** and the framework will:

- turn it into a service (base URL and auth inferred, secrets from `.env`)
- **generate and run test cases for every operation**: contract, positive, negative, boundary, security,
  resilience and performance, with no test code
- create its own test data and the resources tests depend on, then clean them up
- report every request and response, with a cURL, in the HTML report, plus a Slack/Teams summary

Hand-written tests are only needed for business rules, and they stay short:

```js
import { test, expect } from '../../src/fixtures/index.js';

test('creates a pet', { tag: ['@smoke'] }, async ({ api, data }) => {
  const pet = data.build('addPet', { status: 'available' }); // realistic data generated from the spec
  const res = await api.call('addPet', { body: pet }); // auth, logging, schema check, cleanup: automatic
  expect(res).toHaveStatus(200);
  expect(res.body.name).toBe(pet.name);
});
```

---

## Quick start

`api-tests/` is a self-contained project inside the repository, with its own `package.json`, dependencies and
Playwright config. Run every command from this folder, or from the repo root with `npm --prefix api-tests <command>`.

```bash
cd api-tests
npm install
cp .env.example .env        # optional: only needed for real secrets
npm test                    # unit + API tests against TEST_ENV=dev
npm run report              # open the HTML report
```

| Command                                              | What it does                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm test`                                           | Everything (framework unit tests + API tests)                                           |
| `npm run test:api` / `npm run test:unit`             | API tests only / framework self-tests only (offline)                                    |
| `npm run test:generated`                             | Only the generated suites                                                               |
| `npm run test:<category>`                            | `contract`, `positive`, `negative`, `boundary`, `security`, `resilience`, `performance` |
| `npm run test:smoke` / `test:regression`             | Hand-written tests by tag                                                               |
| `TEST_ENV=qa npm test`                               | Another environment (no code change)                                                    |
| `SUITE_SERVICES=orders SUITE_TAGS=cart npm test`     | Narrow generated suites (also `SUITE_OPS`, `SUITES`)                                    |
| `npm run gen -- --list`                              | Every operation in every spec, grouped by service and tag                               |
| `npm run gen -- --plan --op addPet`                  | Every generated case for an operation, with its id                                      |
| `npm run gen -- --op addPet,getPetById --name pets`  | Scaffold an editable test file (`--flow` adds a CRUD flow test)                         |
| `npm run spec:diff -- --git HEAD --service petstore` | What changed in a spec, breaking changes, and affected tests                            |
| `npm run spec:refresh`                               | Re-bundle and validate all specs                                                        |
| `npm run lint` / `npm run format`                    | ESLint + Prettier                                                                       |

---

## Bring your API: drop a file

1. Copy `orders-api.yaml` (OpenAPI 3.x / Swagger 2.0, JSON or YAML) or `Orders.postman_collection.json` into `specs/`.
2. The service is named after the file (`orders-api`). Its env prefix is `ORDERS_API`:
   - base URL: `ORDERS_API_BASE_URL`, or the spec's absolute `servers` URL / Swagger `host`
   - auth: inferred from the spec's security schemes, with secrets from `ORDERS_API_TOKEN`, `_API_KEY`,
     `_USERNAME`/`_PASSWORD` or `_CLIENT_ID`/`_CLIENT_SECRET`/`_TOKEN_URL`. Force a type with `ORDERS_API_AUTH_TYPE`.
     See `.env.example`.
3. `npm run gen -- --plan --service orders-api` shows what will be tested. `SUITE_SERVICES=orders-api npm run test:generated` runs it.

The startup log lists each service and its operation count. It also warns about anything missing, such as a base URL or secret.
For more control (extra auth profiles, cleanup rules, status conventions), add an explicit entry under
`services` in `config/default.js` that points at the same file.

**Postman collections** are converted to OpenAPI on load: folders become tags, `:id` and `{{var}}` become path params,
and raw JSON bodies and saved example responses become schemas. Schemas are inferred from examples, so optional
fields and enums can't be known. Prefer a real OpenAPI spec when one exists. See `examples/postman/` for a sample.

---

## Generated suites: every angle, for every operation

`tests/generated/<category>.spec.js` plan their cases from the specs at run time. New endpoints are covered
the moment they appear, and there are no generated files to maintain.

| Category        | What is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **contract**    | Every GET with real data: status documented, content type documented, body matches the schema                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **positive**    | Happy path with all fields; required fields only; every optional query param; every enum value; full **CRUD lifecycle** (create → read → update → read → delete → 404) with field-by-field persistence checks                                                                                                                                                                                                                                                                                                                                          |
| **negative**    | Missing required field, null, wrong type, value outside enum, length/range violations, empty and missing body, malformed JSON, unsupported Content-Type, missing required query/header, malformed path id, non-existent id → 404, unsupported method → 405                                                                                                                                                                                                                                                                                             |
| **boundary**    | Exact min/max length, value and items (must succeed); just past them (must be rejected); empty, whitespace, unicode/emoji, special characters, 10k-char strings, zero, negative, `MAX_SAFE_INTEGER`, decimals for integers, empty and 500-item arrays (must not 5xx)                                                                                                                                                                                                                                                                                   |
| **security**    | Auth required and invalid credentials → 401; SQL/NoSQL/XSS/path-traversal/command/template/LDAP/CRLF/format-string injection in every string input (no 5xx, no leaked stack traces, SQL errors, class names or file paths, no reflected script, no injected headers); mass assignment (`isAdmin`, `role`…); error-message leakage; sensitive fields in responses; HTTPS; security headers and server version banner; CORS with credentials; TRACE; 404 for unknown routes; oversized payload; optional **IDOR**, **role checks** and **rate limiting** |
| **resilience**  | Concurrent reads, concurrent creates (distinct ids), idempotent PUT, repeated DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **performance** | p95 latency per GET against a budget (`SLA_MS`, per-operation overrides)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**How cases get valid data:** request bodies and params come from the schema. `{petId}` is resolved by creating a
pet via `POST /pet`, nested resources in order. Each created resource is read back, and everything created is
deleted after the test. If an API can't create or doesn't persist a resource, dependent cases are skipped with a
hint to set `resources.pathParams`.

**Test ids:** every case has an id `<category>:<service>:<operationId>:<case>`, shown as the `case id` annotation
and in `npm run gen -- --plan`.

**Tuning** (`config/default.js` → `suites`, `resources`; or `services.<name>.expectations`):

- `expectations`: which statuses count as "rejected", "not found", etc. (`badRequest: [400, 422]` by default). APIs differ.
- `knownIssues`: `{ '<case id pattern>': 'reason' }` with `*` wildcards. A matching failure becomes an expected
  failure with the reason in the report. If it stops reproducing, the test passes with a "did not reproduce" note.
- `excludeOperations`, `includeTags`, `maxCasesPerOperation`, `boundary.*`, `performance.*`
- `security.enabledEnvs`: attack payloads never run outside these environments (dev/qa/stage by default).
- `security.idor` / `roleChecks` / `rateLimit`: need extra identities in `services.<name>.authProfiles`.

Limits: field-level cases cover top-level body fields and query params. Business rules ("a cancelled order can't
be refunded") need hand-written tests. The security suite is an automated baseline on every build, not a
replacement for a penetration test or a DAST scanner.

---

## In-sprint workflow

| Situation      | Do                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| New API / spec | Drop it into `specs/` → `npm run gen -- --plan --service <name>` → run → triage (or `/api-onboard-spec`)                             |
| Spec changed   | `npm run spec:diff -- --git HEAD --service <name>` → update the listed tests (or `/api-spec-update`)                                 |
| New story      | Generated suites cover the endpoint. Write business-rule tests: `npm run gen -- --op <ids> --name <feature>` (or `/api-test-author`) |
| Red build      | Classify: test bug, spec drift, API defect, environment or framework (or `/api-test-fix`)                                            |

### Claude Code skills

When you work in this repo with Claude Code, these project skills (in `.claude/skills/`) run the workflows above.
`CLAUDE.md` holds the conventions they follow.

| Skill               | Use it for                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `/api-onboard-spec` | "Here is our orders swagger/Postman file". Connects it, runs it, triages findings              |
| `/api-test-author`  | Paste a story or acceptance criteria. Writes, runs and reports tests with a traceability table |
| `/api-test-fix`     | Failing tests. Classifies each failure, fixes the tests, and reports API defects with a cURL   |
| `/api-spec-update`  | A changed spec. Diff, impact, test updates and new coverage                                    |

The skills never weaken assertions, add known issues or exclude endpoints without asking you first.

---

## Fixtures

### `api`

```js
await api.call('getPetById', { path: { petId: 1 } });
await api.call('findPetsByStatus', { query: { status: ['available', 'sold'] } }); // arrays repeat the key
await api.call('addPet', { body, headers: { 'X-Trace': '1' }, timeoutMs: 5000 });
await api.call('addPet', { body, validate: false, cleanup: false }); // opt out per call
await api.call('billing:getInvoice', { path: { id } }); // "service:operationId" when ids clash across specs
await api.as('anonymous').call('getInventory'); // another auth profile ($none and $invalid are built in)
await api.get('/pet/findByStatus', { query: { status: 'sold' } }); // raw path: still schema-validated
```

Every call returns an `ApiResponse`: `status`, `headers`, `body` (parsed JSON or text), `text`, `durationMs`,
`ok`, `operation`, and `get('$.path.to[0].field')`.

### `data`: self-generated test data

| Method                                          | Returns                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `data.build('addPet', overrides)`               | Valid request body from the spec. Overrides are deep-merged.            |
| `data.build('addPet', {}, { optional: false })` | Required fields only                                                    |
| `data.buildMany('addPet', 5)`                   | Five bodies                                                             |
| `data.fromSchema('User', overrides)`            | Any component schema                                                    |
| `data.params('findPetsByStatus')`               | `{ path, query, headers }` with required params filled                  |
| `data.invalid('addPet')`                        | Negative cases: missing required, wrong type, null, enum, length, range |
| `data.unique('order')` / `uniqueId()`           | Values unique across parallel workers                                   |
| `data.faker`                                    | Seeded [Faker](https://fakerjs.dev) instance                            |

- **Realistic values:** fields such as `email`, `username`, `firstName`, `phone`, `city` and `url` get matching Faker
  values (`src/data/smart-hints.js`). To force a generator, add `x-faker: "commerce.price"` in the spec.
- **Spec-aware:** respects `enum`, `format`, `pattern`, min/max and `required`. Request bodies skip `readOnly` fields.
  Numeric `id`s are unique per run, unbounded numbers are positive, and file uploads are never empty.
- **Reproducible:** every run has a seed (`DATA_SEED=…` in the report). Re-run with `DATA_SEED=<seed>` for identical data.

### `resources`

`await resources.pathParams('getOrderById')` returns `{ orderId: 123 }` after creating a real order (and its pet if needed).
Fixed values for resources the API can't create: `resources.pathParams` in config (`'<service>:<param>'` or `'<param>'`).

### `cleanup`

Anything created through `api.call` is deleted after the test when the spec has a matching `DELETE` (inferred from
paths: `POST /pet` is undone by `DELETE /pet/{petId}`). Explicit rules override inference:

```js
cleanup: {
  createUser: { operation: 'deleteUser', path: { username: '$.username' } }, // "$." reads from the create response
},
```

For anything else: `cleanup.add('remove temp file', async () => { ... })`. Cleanup runs most recent first, ignores `404`, and
annotates failures without failing the test.

### Assertions (`expect`)

| Matcher                                          |                                                            |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `toHaveStatus(201)` / `toHaveStatus([400, 422])` | Failure message includes the method, URL and response body |
| `toMatchSchema()`                                | Schema documented for this operation + status              |
| `toMatchSchema('Pet')` / `toMatchSchema({...})`  | Named component schema / inline schema                     |
| `toRespondWithin(500)`                           | Response time in ms                                        |
| `toHaveHeader('content-type', /json/)`           | Header present, optionally equal to a value or regex       |

Hand-written `api.call`s are also **soft-checked against the spec automatically** (`AUTO_VALIDATE=false` to disable).

---

## Configuration

`config/default.js` holds everything; `config/env/<env>.js` overrides only what differs; `TEST_ENV` picks the
environment; secrets come from env vars / `.env` (see `.env.example`). Config is validated at startup with
clear messages.

**Add an environment:** create `config/env/uat.js` and register it in `config/index.js`.

**Add a service explicitly** (instead of, or on top of, discovery):

```js
services: {
  billing: {
    spec: 'specs/billing.yaml',               // or 'https://billing.example.com/openapi.json'
    baseURL: env('BILLING_BASE_URL'),
    auth: { type: 'oauth2', grantType: 'client_credentials', tokenUrl: env('BILLING_TOKEN_URL'),
            clientId: env('BILLING_CLIENT_ID'), clientSecret: env('BILLING_CLIENT_SECRET'), scope: 'invoices' },
    authProfiles: { readonly: { type: 'bearer', token: env('BILLING_READONLY_TOKEN') } },
    expectations: { badRequest: [400, 409] }, // this API's conventions
  },
}
```

**Auth types** (per service, plus extra `authProfiles` used with `api.as()`):

| type     | options                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`   | –                                                                                                                                                                 |
| `apiKey` | `name`, `value`, `in: 'header' \| 'query'`                                                                                                                        |
| `basic`  | `username`, `password`                                                                                                                                            |
| `bearer` | `token`, **or** `login: { path, body, tokenPath: '$.token' }`; optional `header`, `scheme`                                                                        |
| `oauth2` | `tokenUrl`, `clientId`, `clientSecret`, `scope`, `audience`, `grantType: client_credentials \| password`, `username`, `password`, `clientAuth: 'body' \| 'basic'` |
| `cookie` | `login: { path, method, body \| form }`: cookies are kept for the worker                                                                                          |

Credentials are fetched **once per worker**, OAuth2 tokens refresh before expiry, and any `401` triggers one re-login and retry.

---

## Reporting

- **Playwright HTML report** (`reports/html`, `npm run report`): tests are grouped by category and operation. Every API
  call is a step with an attachment containing the request, response, timing, retry count and a ready-to-paste
  **cURL**. Secrets (`maskHeaders`, `maskFields` in config) are masked. Annotations show the case id, data seed,
  known-issue reason, latency stats and cleanup problems. Filter by tag (`@security`, `@boundary`…) in the report.
- **Slack / Teams summary** after each run: set `CHAT_WEBHOOK_URL` and `CHAT_PROVIDER=slack|teams`. Optional:
  `CHAT_ONLY_ON_FAILURE=true`, `REPORT_URL` for a link button, `CHAT_DRY_RUN=true` to print the payload instead.

---

## Scaling to large specs

- Specs are **bundled once and cached** in `.cache/specs` (keyed by file content). Workers read the cache instead
  of re-parsing. External `$ref` files are supported.
- Schemas are compiled **lazily** and cached per operation, so a 5,000-operation spec costs nothing until an endpoint is used.
- Split big systems into **multiple services/specs**. Operations are addressable as `operationId` or `service:operationId`.
- Generated suites scale linearly with operations. Narrow day-to-day runs with `SUITE_TAGS` / `SUITE_OPS` and run
  everything nightly. `maxCasesPerOperation` caps each category.
- Typos get suggestions: `Unknown operation "addPett". Did you mean: addPet?`

---

## Project layout

```text
<repo root>/
  .github/workflows/api-tests.yml   API CI (must live at the repo root)
  .husky/pre-commit                 shared git hook (must live at the repo root)
  api-tests/                        everything below lives here

config/            default.js + env/<env>.js: everything configurable
specs/             API definitions; every file here is a service
examples/          sample Postman collection
src/
  fixtures/        test + expect: the only import tests need
  core/            Api facade, HTTP client (retries, re-auth), session pool, cleanup, request logger
  auth/            none | apiKey | basic | bearer | oauth2 | cookie
  spec/            loader + cache, registry, discovery, Postman converter, schema inference, spec diff
  validation/      AJV schema validator (lazy, cached) + custom matchers
  data/            data factory, smart Faker hints, negative-case derivation
  scenarios/       generated-suite engine: one planner per category, resource resolver, attack payloads
  reporters/       Slack / Teams summary reporter
scripts/           generator / planner CLI, spec diff, spec refresh
tests/
  generated/       one loader per category (do not edit; tune via config)
  <service>/       hand-written business tests
  unit/            framework self-tests
.claude/skills/    Claude Code workflows for the team (active when working inside api-tests/)
CLAUDE.md          conventions for Claude Code in this folder
```

Layers only depend downwards: **tests → fixtures → core / data / validation / scenarios → spec → config**.

---

## Coding standards

- ES modules, Node ≥ 22, ESLint (recommended + `eslint-plugin-playwright`) and Prettier. Both run in CI and on
  commit through the repo's husky hook + lint-staged (see [Part of the web repository](#part-of-the-web-repository)).
- Framework code is covered by unit tests (`tests/unit`). Add one with every change in `src/`.
- Test titles describe behaviour; tags go in the `tag` option (`@smoke`, `@regression`).
- Tests are independent: no shared state, unique data per test, automatic cleanup. They are safe with `fullyParallel`.
- Never hard-code URLs, ids or secrets in tests. Put them in config or env.

## CI

`.github/workflows/api-tests.yml` (at the repo root) runs inside `api-tests/` and only when files under it change, so
web-only changes never trigger it. It runs lint and unit tests, then a **spec diff gate** on PRs that change `specs/`
(fails on breaking changes). PRs run smoke, contract and regression tests; nightly, manual and deployment runs execute
everything. The workflow uploads the HTML report (`api-html-report-<env>`) and posts the chat summary.

**Run after an API deployment:** call it from the deployment workflow:

```yaml
jobs:
  api-tests:
    needs: deploy-api
    uses: ./.github/workflows/api-tests.yml
    with: { test_env: qa }
    secrets: inherit
```

Other CI systems only need `cd api-tests && npm ci && npx playwright test --project=api` with the same env vars.

## Part of the web repository

`api-tests/` shares nothing with the web framework except the git repository. Its `package.json` sets
`"type": "module"` for this folder only, so the web framework's CommonJS code is unaffected. To wire it into the root:

| Root file                    | Add                                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (optional)    | `"api:install": "npm --prefix api-tests ci"`, `"api:test": "npm --prefix api-tests test"`, `"api:lint": "npm --prefix api-tests run lint"`                                          |
| `.husky/pre-commit`          | Nothing if it already runs `npx lint-staged` (lint-staged picks up `api-tests/package.json` and runs its tasks on API files only). Otherwise add `cd api-tests && npx lint-staged`. |
| Web ESLint / Prettier config | Ignore `api-tests/` (it has its own config): `ignores: ['api-tests/**']` in ESLint, `api-tests/` in `.prettierignore`                                                               |
| Web `playwright.config.js`   | Make sure `testDir` does not include `api-tests/` (it only does if `testDir` is the repo root)                                                                                      |
| `.github/workflows/`         | Copy `api-tests.yml`; add `paths-ignore: ['api-tests/**']` to the web workflow so API changes skip web CI                                                                           |

Claude Code: the skills in `api-tests/.claude/skills` and `api-tests/CLAUDE.md` load automatically when you work on
files inside `api-tests/`.

## About the sample API

The sample service is the public [Swagger Petstore](https://petstore3.swagger.io). The generated suites found real
defects there: no auth enforcement, no input validation, 500 on an empty body, Java class names in error
messages, server temp paths in upload responses, a missing `nosniff` header, and shared data that violates
the schema. They are recorded as `suites.knownIssues` in `config/default.js`, so the suite stays green while still
showing them. Its `/user` endpoints return 500 for every call and are excluded. Replace `specs/petstore.json` and
the `petstore` service (and its known issues) with your own API.
