---
name: api-test-author
description: Write API tests from a user story, acceptance criteria, ticket or plain-language scenario, using this framework's fixtures and conventions, then run them until they pass or expose a real defect. Use when the user pastes a story/AC, gives a ticket id, or asks to "automate", "write tests for", or "cover" a feature or endpoint.
---

# Author tests from a story

Run every command from the `api-tests/` folder (it is a self-contained project inside a larger repo); paths below are relative to it.

The generated suites (`tests/generated`) already cover per-endpoint positive, negative, boundary, security,
resilience, performance and contract checks. Hand-written tests exist for what a spec cannot express:
**business rules, workflows across endpoints, state transitions, roles and data relationships.** Do not
duplicate generated coverage.

## 1. Understand the story

- Extract each acceptance criterion as a numbered, testable statement. If the input is a ticket id and a ticket tool/connector is available, fetch it; otherwise ask the user to paste it.
- List ambiguities (undefined status codes, unclear rules, missing data) and ask the user **before** writing tests that guess.

## 2. Map criteria to operations

- `npm run gen -- --list` (add `--tag`/`--service`) to find operationIds; read `specs/` for schemas.
- `npm run gen -- --plan --op <ids>` to see what generated suites already cover; skip criteria fully covered there and say so.
- If an endpoint the story needs is missing from the spec, stop and tell the user (spec may be outdated).

## 3. Write the tests

- File: `tests/<service>/<feature>.spec.js` (kebab-case). Scaffold with `npm run gen -- --op <ids> --name <feature> [--flow]` then rewrite the bodies.
- Always `import { test, expect } from '../../src/fixtures/index.js';`
- One `test.describe` per story; one `test` per criterion, titled by behaviour (`'rejects refund of a cancelled order'`), tagged: `{ tag: ['@regression'] }` (add `@smoke` for the critical path). Put the criterion number in the title or an annotation for traceability.
- Fixtures: `api.call('<opId>', { path, query, headers, body })`, `data.build('<opId>', overrides)`, `data.fromSchema('<Schema>')`, `data.unique()`, `resources.pathParams('<opId>')` (creates parent resources), `api.as('<profile>')` for roles, `cleanup.add()` for anything not auto-cleaned.
- Assertions: `toHaveStatus`, `toMatchSchema`, `toHaveHeader`, `toRespondWithin`, plus plain `expect` on `res.body` fields that encode the rule. Assert the business outcome, not just the status.
- Rules: no hard-coded URLs, ids, secrets or dates; no sleeps (poll with `expect.poll` if the API is async); no shared state between tests; each test creates its own data. Created resources are deleted automatically when the spec has a matching DELETE or `services.<name>.cleanup` has a rule — add a rule if neither applies.
- Follow the style of `tests/petstore/pet.spec.js`.

## 4. Run and iterate

```bash
npx playwright test tests/<service>/<feature>.spec.js --reporter=list
```

- Fix test mistakes. When a test fails because the API contradicts the criterion, keep the test, mark nothing as passing, and report it as a defect with the cURL from the report attachment. Ask the user whether to `test.fail()` it with a ticket reference.
- Never weaken an assertion to make a test pass without the user's agreement.
- `npm run lint` must pass.

## 5. Report back

- Traceability table: criterion → test title → status (pass / defect / blocked + reason).
- Generated-suite coverage you relied on instead of writing tests.
- Open questions and defects found.
