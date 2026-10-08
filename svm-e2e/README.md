# svm-e2e - Black Duck -> SVM sync test

Proves that a component and vulnerability added in Black Duck appear in SVM within the sync window
(about 8 h), and that a removal shows up too. It is **scan-driven**: the component is added by
uploading a CycloneDX SBOM to code location `e2e-<run_id>` and removed by uploading the SBOM again
without it (mode=replace), falling back to unmapping the code location. The test account only needs
scan rights - never BOM delete.

A run is one row in the run store; an hourly pipeline advances it, so nothing sleeps for 8 hours.

```
ADDED -> WAITING_ADD_SYNC -> ADD_VERIFIED -> REMOVING -> REMOVED -> REMOVE_VERIFIED
            \-> ADD_TIMEOUT / ADD_FAILED     \-> REMOVAL_BLOCKED    \-> REMOVE_TIMEOUT / REMOVE_FAILED
```

`REMOVING` is the one state added to the plan: the remove SBOM is uploaded, then the BOM is
re-checked on later ticks so no job waits on Black Duck's processing.

## Commands (Node 20+)

| Command                          | What it does                                                            |
| -------------------------------- | ----------------------------------------------------------------------- |
| `npm run start-run`              | Start a run (add SBOM, wait for BOM, save as ADDED)                     |
| `npm run tick`                   | Black Duck steps: ADDED -> WAITING, removal, 401/403 -> REMOVAL_BLOCKED |
| `npm run verify`                 | Playwright SVM checks for every due run                                 |
| `npm run notify`                 | Slack/Teams summary for finished runs                                   |
| `npm run tick:all`               | tick, verify, notify (the hourly pipeline)                              |
| `npm run cleanup`                | Flag runs stuck >24 h, unmap leftover code locations                    |
| `npm run status`                 | Print every run                                                         |
| `npm test` / `npm run typecheck` | Unit tests (mocked Black Duck) / types                                  |

> New here? Start with the [beginner guide](../docs/svm-e2e-sync.md).

## How to run it

1. **Install** (Node 20+): `cd svm-e2e && npm ci && npx playwright install chromium`.
2. **Do the Phase 0 spikes** against your instances and fix the items under "Must be confirmed"
   below. Create the Black Duck project `svm-e2e-sync` and a service account with scan rights on it.
3. **Configure**: edit `config/settings.yaml` (Black Duck URL, SVM URLs and paths, components), then
   export the secrets:
   ```sh
   export BD_API_TOKEN=...      # Black Duck, scan rights on the test project only
   export SVM_API_TOKEN=...     # SVM, read-only
   export SLACK_WEBHOOK_URL=... # optional; summaries are printed when unset
   ```
4. **Check it works offline**: `npm test && npm run typecheck`.
5. **Start a run**: `npm run start-run`. It uploads the add SBOM, waits for the BOM, and saves the
   run as `ADDED`, due in 8 hours. Check it with `npm run status`.
6. **Advance it**: run `npm run tick:all` every hour (the `pipelines/tick.yml` schedule does this).
   Each tick moves due runs forward, runs the SVM checks, and notifies finished runs. A run takes
   about 16-20 hours end to end.
7. **Read results**: `npm run status`, the JUnit file at `results/junit.xml`, and the HTML report
   in `playwright-report/`.
8. **Rerun a step**: edit the run's `state` and `nextCheckAt` in `.data/e2e_runs.json` (for example
   set `WAITING_ADD_SYNC` and a past time), then run `npm run verify`.
9. **Clean up**: `npm run cleanup` flags runs stuck for more than 24 hours and unmaps leftover code
   locations. Rotate tokens by replacing the CI secrets.

## Configuration

`config/settings.yaml` (validated with zod). Secrets come from the environment: `BD_API_TOKEN`
(scan rights on the test project only), `SVM_API_TOKEN` (read-only), optional
`SVM_UI_STORAGE_STATE` (signed-in Playwright state), `SLACK_WEBHOOK_URL`, `STORE_PATH`
(default `.data/e2e_runs.json`).

## Result codes

PASS; FAIL and TIMEOUT mean the sync is broken; BLOCKED (401/403 on removal) and ERROR
(infrastructure) do not count as product failures. The SVM API decides pass/fail; the UI check is
recorded in the run's evidence and never fails a run on its own.

## Must be confirmed against your instances (Phase 0 spikes)

These are written from the design doc, not from a live Black Duck/SVM, and are **not yet verified**:

- `blackduck.sbom_upload_path` and its query parameters (`ApiScanUploader`), or swap in Detect.
- The code-location unmap call (`PUT /api/codelocations/{id}` with an empty `mappedProjectVersion`).
- The BOM / vulnerable-components endpoints and response shapes in `src/bd-client.ts`.
- SVM's components endpoint, response shape and asset page (`svm.*` in settings, `verify/svm-api.ts`,
  `verify/pages/svm-asset-page.ts` - a minimal stand-in for the existing page objects).
- Component choices in `settings.yaml`.

## Known limits

The JSON run store has no row locking, so run one tick at a time (the pipelines set a concurrency
group) and persist the file between pipeline runs, or swap `RunStore` for SQLite/Postgres.
