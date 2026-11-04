# API Automation Framework — working notes for Claude

Playwright + JavaScript (ES modules, Node ≥ 22) API testing driven by OpenAPI/Swagger/Postman specs. See README.md for the user guide.

This folder (`api-tests/`) is a self-contained project inside a larger repo that also holds a web UI framework.
Run every command from `api-tests/` (or `npm --prefix api-tests …` from the root). Never install API dependencies
in the root `package.json` or edit web framework files. The only root-level API files are
`.github/workflows/api-tests.yml` and the shared `.husky/pre-commit` hook.

## Skills in this repo

- `/api-onboard-spec` — new spec/collection → connected service → triaged first run
- `/api-test-author` — story / acceptance criteria → hand-written tests
- `/api-test-fix` — failing tests → classified and fixed or reported
- `/api-spec-update` — changed spec → diff, impact, updated tests

## Commands

- `npm run test:unit` — framework self-tests (offline, fast). Run after any change in `src/`.
- `npx playwright test --project=api [files] [--grep @tag]` — API tests. `SUITE_SERVICES`, `SUITE_TAGS`, `SUITE_OPS`, `SUITES` filter generated suites.
- `npm run gen -- --list | --plan --op <ids> | --op <ids> --name <feature> [--flow]`
- `npm run spec:diff -- --git HEAD --service <name>`; `npm run spec:refresh`
- `npm run lint` must pass before finishing.

## Layout and boundaries

- `config/` — all settings; `default.js` + `env/<env>.js`; secrets only via env/.env (never commit secrets).
- `specs/` — API definitions; any file here is auto-discovered as a service.
- `src/core` HTTP/auth sessions/api facade · `src/spec` loading, registry, discovery, Postman, diff · `src/data` generation · `src/validation` AJV + matchers · `src/scenarios` generated-suite planners (one module per category) · `src/fixtures` the only import for tests.
- `tests/generated/*.spec.js` are thin loaders — change behaviour in `src/scenarios` or config, never there.
- `tests/<service>/` hand-written business tests; `tests/unit/` framework tests.

## Conventions

- Tests import `{ test, expect }` from `src/fixtures/index.js` and use `api`, `data`, `resources`, `cleanup` fixtures. No raw URLs, hard-coded ids, secrets, sleeps or shared state.
- Titles describe behaviour; tag with `@smoke` / `@regression` via `{ tag: [...] }`.
- Generated test ids: `<category>:<service>:<operationId>:<case>`; used by `suites.knownIssues` (wildcards) and visible as the `case id` annotation.
- Never weaken assertions, widen expected statuses, add known issues or exclusions without the user's agreement. API defects are reported with the cURL from the report attachment.
- Security payload suites only run in `suites.security.enabledEnvs`; never point them at production.
- Match existing style: small modules, JSDoc on public functions, comments only for non-obvious reasons. Prettier (120 cols, single quotes) and ESLint config are authoritative.
