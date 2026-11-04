---
name: api-onboard-spec
description: Onboard a new API into the test framework from an OpenAPI/Swagger file (JSON/YAML), a Postman collection, or a spec URL — wire base URL and auth, run the generated suites, and triage the first results into fixes, config and known issues. Use when the user drops or names a new spec/collection, or asks to "add an API", "test this swagger/postman file", or "onboard a service".
---

# Onboard a new API

Run every command from the `api-tests/` folder (it is a self-contained project inside a larger repo); paths below are relative to it.

Goal: a new spec goes from file to a triaged first run with no hand-written code.

## 1. Place the file

- Copy the file into `specs/` (keep the user's file name; it becomes the service name: `Orders API.postman_collection.json` → `orders-api`).
- For a spec URL, either download it into `specs/`, or add an explicit entry in `config/default.js` → `services.<name>.spec: '<url>'`.
- Supported: OpenAPI 3.0/3.1, Swagger 2.0 (JSON or YAML, external `$ref` files OK), Postman v2.0/v2.1.
- Postman collections are converted at load time and schemas are **inferred from example bodies**. Tell the user that optional fields and enums cannot be inferred, and offer to export a real OpenAPI spec if one exists.

## 2. Connect it

- Run `npm run gen -- --list --service <name>`. The setup log line prints every service with its operation count and base URL, plus discovery warnings.
- Base URL: `<PREFIX>_BASE_URL` in `.env` (prefix = service name upper-snake: `orders-api` → `ORDERS_API`), else the spec's absolute `servers[0]` / Swagger `host`.
- Auth is inferred from the spec's security schemes; secrets come from env: `<PREFIX>_API_KEY`, `_TOKEN`, `_USERNAME`/`_PASSWORD`, `_CLIENT_ID`/`_CLIENT_SECRET`/`_TOKEN_URL`/`_SCOPE`, or force a type with `<PREFIX>_AUTH_TYPE`. Ask the user for values; never invent or commit secrets — write them to `.env` only (it is git-ignored).
- If the service needs more than discovery gives (extra auth profiles for role/IDOR checks, cleanup rules, expectation overrides), promote it to an explicit entry in `config/default.js` → `services` with the same `spec` path.

## 3. Preview coverage

- `npm run gen -- --plan --service <name>` lists every generated case per category with its id. Summarise counts per category for the user.
- Security attack payloads run only in `suites.security.enabledEnvs` (dev/qa/stage). Confirm the target is not production before running them.

## 4. First run

```bash
SUITE_SERVICES=<name> npx playwright test tests/generated --reporter=list
```

For big specs, start with `SUITE_TAGS=<tag>` or `SUITES=contract,positive`.

## 5. Triage — every failure goes into exactly one bucket

| Symptom                                                                                                 | Action                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Many tests **skipped** with "setup: … the API may not persist writes" or "no POST endpoint creates {x}" | Add an existing id: `resources.pathParams["<service>:<param>"]` in config. Ask the user for a real id.                                                                                                                                                  |
| Status codes differ only by convention (e.g. API uses 409 or 404 for validation)                        | Override `services.<name>.expectations` (e.g. `badRequest: [400, 409]`). Ask before widening.                                                                                                                                                           |
| API behaves wrongly vs. its own spec (accepts invalid data, 500s, missing auth, leaks)                  | It is a **finding**. List them for the user grouped by root cause. Only after the user agrees, add `suites.knownIssues` patterns with a one-line reason (patterns use the case id shown in the report, `*` wildcards). Never add known issues silently. |
| Endpoint unusable in this env (broken, destructive, external side effects)                              | `suites.excludeOperations: ['<service>:<opId>']` with a comment saying why.                                                                                                                                                                             |
| Framework limitation                                                                                    | Explain it; do not paper over it with known issues.                                                                                                                                                                                                     |

Use `npx playwright test ... --reporter=json` or the HTML report attachments (request, response, cURL) as evidence. Quote the cURL when reporting an API defect.

## 6. Finish

- Re-run until the suite is green (known issues count as expected failures).
- Run `npm run lint`.
- Report: operations covered, cases per category, findings (with reasons and cURL), config changes made, and anything still needing the user (ids, secrets, profiles for IDOR/role checks).
- Suggest `/api-test-author` for business-rule tests the spec cannot express.
