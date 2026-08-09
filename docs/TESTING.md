# Testing Guide

The repository uses Node's built-in test runner, ESLint flat configuration, built-in test coverage, and GitHub Actions.

## Backend commands

Run from `backend/`:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run test:coverage
npm.cmd run check
```

`npm run check` is the normal local quality gate. It runs ESLint and coverage-enforced tests.

Current minimum coverage thresholds:

| Metric | Minimum |
|---|---:|
| Lines | 70% |
| Branches | 75% |
| Functions | 60% |

`src/db/client.js` is excluded from the built-in coverage command because importing it intentionally terminates startup when required database environment variables are missing. Database behavior is covered separately by service/migration tests and the opt-in integration test.

## Test categories

- Pure parsing/normalization tests
- Reservation resolution and identity-safety tests
- Rules-engine deterministic behavior tests
- Classifier context/response validation tests
- AI outcome and automation-setting tests
- Message persistence/delivery reconciliation tests
- Authentication/operator middleware tests
- Intent route validation/flow tests
- Handover and escalation service tests
- SQL migration structure/safety tests
- Opt-in database concurrency tests

Normal tests mock external/provider boundaries. They do not send real WhatsApp messages or call OpenAI.

## Database integration tests

`npm run test:integration` requires `SUPABASE_DB_URL` or `DATABASE_URL`. The wrapper explicitly enables the skipped integration test.

```powershell
$env:SUPABASE_DB_URL='postgresql://...dedicated-test-db...'
npm.cmd run migrate
npm.cmd run test:integration
```

The escalation integration test verifies:

- Many concurrent create calls produce one open escalation
- Concurrent resolve calls are idempotent
- Create/resolve races end in a consistent resolved state
- Resolved conversations cannot be escalated again
- Audit events are not duplicated

Use a dedicated test database only. The test creates and deletes records, and the migration command changes schema/functions.

## Frontend commands

Run from `frontend/`:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The production build is part of verification because it catches Vite/module/bundling problems that unit tests do not.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests:

- Backend dependency install
- Backend lint/tests/coverage thresholds
- Frontend dependency install
- Frontend lint/tests/build

`.github/workflows/database-integration.yml` is a manual workflow. Configure the protected `database-integration` environment with a `TEST_DATABASE_URL` secret pointing to a dedicated test database before running it.

## Writing tests

Preferred conventions:

1. Put backend tests under `backend/test/` and name them `*.test.js`.
2. Name real database tests `*.integration.test.js` and keep them opt-in.
3. Use service factories/dependency injection instead of monkey-patching global modules.
4. Assert side effects explicitly: dispatched messages, database calls, escalations, and state updates.
5. Test fail-closed behavior for missing configuration and provider/database failures.
6. Avoid raw guest text, phone numbers, API keys, or secrets in fixtures/log output.
7. Keep tests deterministic; derive date fixtures carefully for active reservations.
8. Add regression tests with every bug fix.

## Troubleshooting tests

- On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1` execution.
- If Vite cannot write `node_modules/.vite-temp`, run the build in an environment with normal workspace write permissions.
- Expected warning/error logs may appear when a test intentionally checks fail-closed behavior.
- If integration tests skip during `npm test`, that is intentional. Run the explicit integration command with a test database to enable them.
