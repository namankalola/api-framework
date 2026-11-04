---
name: api-spec-update
description: Handle a changed OpenAPI spec or Postman collection — diff old vs new, classify breaking changes, find affected hand-written tests, update them, and scaffold tests for new endpoints. Use when the user updates a file in specs/, says the API or contract changed, or asks what a spec change impacts.
---

# Apply a spec change

Run every command from the `api-tests/` folder (it is a self-contained project inside a larger repo); paths below are relative to it.

## 1. Diff

- Old version from git: `npm run spec:diff -- --git HEAD --service <name>` (uncommitted change) or `--git <rev>`.
- Old version as a file: `npm run spec:diff -- --old <old-file> --service <name>` (or `--new <file>`).
- Add `--json` when you need to process the result. Exit code 1 means breaking changes.
- If the user only has the new file, save the current `specs/<file>` aside first (copy to the scratchpad), then replace it.

## 2. Explain the impact

Summarise for the user:

- **Added** operations → covered automatically by generated suites; candidates for business tests.
- **Removed** operations and **breaking** changes (new required fields/params, type changes, removed response fields, removed enum values, removed 2xx) → which hand-written tests break (the diff lists them under "Hand-written tests to review").
- **Warnings/info** → usually no test change; mention notable ones (renamed operationId, deprecations, auth changes).

## 3. Update

- Hand-written tests: update operationIds, required fields (`data.build` handles new required fields automatically — only fix explicit overrides/assertions), and assertions on changed fields. Do not touch `tests/generated`.
- Config: rename operationIds in `services.<name>.cleanup`, `suites.knownIssues`, `suites.excludeOperations`, `suites.performance.perOperation`, `resources.pathParams`.
- New endpoints: `npm run gen -- --op <ids> --name <feature>` for a scaffold if business tests are wanted; suggest `/api-test-author` with the story.
- Refresh caches: `npm run spec:refresh` (also validates the spec — report validation errors to the user).

## 4. Verify

```bash
npm run test:unit
SUITE_SERVICES=<name> npx playwright test --project=api --reporter=list
```

Triage failures with the `/api-test-fix` rules: a failure caused by the API not yet implementing the new spec is spec/API drift to report, not a test to weaken.

## 5. Report

Changes found (added/removed/breaking), files updated, new coverage, remaining failures with their class, and whether the deployed API matches the new spec.
