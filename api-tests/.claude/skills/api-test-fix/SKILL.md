---
name: api-test-fix
description: Triage and fix failing API tests in this framework — classify each failure as test bug, spec drift, API defect, environment/data issue or framework bug, fix what belongs to the tests, and report the rest with evidence. Use when tests fail, CI is red, the user shares a failure/report, or asks to "fix", "debug" or "triage" tests.
---

# Triage and fix failing tests

Run every command from the `api-tests/` folder (it is a self-contained project inside a larger repo); paths below are relative to it.

## 1. Collect failures

- If the user named tests, run just those; otherwise rerun the failing set:
  `npx playwright test --last-failed --reporter=list` (or the CI command / grep they give).
- For structured data: `npx playwright test <files> --reporter=json 2>/dev/null > reports/last.json`, then read each failed test's
  `error.message`, annotations (`case id`, `data seed`, `known issue…`) and JSON attachments (request, response, cURL).
- Note the `DATA_SEED`; reproduce data-dependent failures with `DATA_SEED=<seed> npx playwright test …`.
- Check flakiness: rerun once with `--repeat-each=3` before blaming the API.

## 2. Classify each failure (exactly one)

| Class                  | Signals                                                                                                                                    | Action                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Test bug**           | Wrong expectation, stale ids, ordering assumptions, shared state, hard-coded data                                                          | Fix the test.                                                                                                                                                                                          |
| **Spec drift**         | Response/request differs from spec; `npm run spec:diff -- --git HEAD~1 --service <s>` shows changes; schema errors name new/removed fields | If the API is right and the spec is stale, tell the user the spec needs updating (do not edit vendor specs without asking). If the spec changed, update hand-written tests (see `/api-spec-update`).   |
| **API defect**         | API contradicts its own spec or the story: 5xx, accepts invalid input, wrong status, leaks data                                            | Do **not** change assertions. Report with the cURL and response. Offer a `suites.knownIssues` entry (generated tests) or `test.fail()` with ticket id (hand-written) — only with the user's agreement. |
| **Environment / data** | Timeouts, 502/503, auth errors, "setup: …" skips, missing ids, shared data changed by others                                               | Fix config/env (`.env`, `resources.pathParams`, `services.<name>.expectations`, `http.retries`) or report the outage. Never add retries to hide a deterministic failure.                               |
| **Framework bug**      | Error originates in `src/` (stack trace through `src/core`, `src/scenarios`, `src/data`), wrong generated data, wrong case planned         | Fix in `src/`, add/extend a unit test in `tests/unit`, run `npm run test:unit`.                                                                                                                        |

## 3. Fix rules

- Smallest change that fixes the root cause; explain the cause in one line per fix.
- Never weaken or delete an assertion, widen expected statuses, add a known issue, or exclude an operation without the user's explicit agreement — propose it instead.
- Generated-suite failures are fixed through config (`config/default.js` → `suites`, `resources`, `services.<name>.expectations`) or `src/scenarios`, never by editing `tests/generated/*.spec.js`.
- Keep hand-written tests independent and data-unique (`data.unique()`, `data.build()`).

## 4. Verify

- Rerun the affected tests, then the whole affected file(s); `npm run test:unit` if `src/` changed; `npm run lint`.

## 5. Report

Table: test → class → root cause → action taken / proposed. Then list API defects with cURL repro, and decisions the user needs to make.
