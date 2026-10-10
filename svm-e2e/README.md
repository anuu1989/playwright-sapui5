# svm-e2e: Black Duck → SVM sync test

Proves that a component and vulnerability added in Black Duck appear in SVM within the sync window
(about 8 hours), and that a removal shows up too. It is **scan-driven**: the component is added by
uploading a CycloneDX SBOM to code location `e2e-<run_id>` and removed by uploading the SBOM again
without it (`mode=replace`), falling back to unmapping the code location. The test account only
needs scan rights, never BOM delete.

A run is one row in a run store; an hourly pipeline moves it forward, so nothing sleeps for 8 hours.

```text
ADDED → WAITING_ADD_SYNC → ADD_VERIFIED → REMOVING → REMOVED → REMOVE_VERIFIED
            ↘ ADD_TIMEOUT / ADD_FAILED      ↘ REMOVAL_BLOCKED   ↘ REMOVE_TIMEOUT / REMOVE_FAILED
```

> New here? Read the [beginner guide](../docs/svm-e2e-sync.md).

## Try it in one minute (no accounts needed)

```bash
cd svm-e2e
npm ci
npx playwright install chromium
npm test        # unit + HTTP integration tests
npm run demo    # whole lifecycle against a local mock Black Duck + SVM, in ~15 seconds
```

`npm run demo -- --ignore-replace` shows the unmap fallback, and `npm run demo -- --block` shows
`REMOVAL_BLOCKED`. The mock proves the plumbing is self-consistent; it does not prove the real
systems behave the same way (see [what must be confirmed](#must-be-confirmed-against-your-instances)).

## Run it for real

1. **Run the spike**: `npm run spike` checks every assumption against your real Black Duck and SVM and
   writes `results/spike-report.md`. Fix what fails (see the [runbook](docs/runbook.md#phase-0-spike-validate-against-your-real-systems)).
2. **Configure**: edit `config/settings.yaml` (project, SVM paths, components) and export:
   ```bash
   export BD_URL=https://blackduck.your-company.internal  # internal deployment URL
   export BD_API_TOKEN=...      # scan rights on the test project only
   export SVM_API_URL=...  SVM_UI_URL=...  SVM_API_TOKEN=...  # SVM, read-only
   export SLACK_WEBHOOK_URL=... # optional
   ```
   If the servers use a private CA, also set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.
3. **Start a run**: `npm run start-run`, then check it with `npm run status`.
4. **Advance it**: run `npm run tick:all` every hour. `pipelines/tick.yml` does this and keeps the
   run store on the `svm-e2e-state` branch between runs. A run takes about 16–20 hours.

## Commands (Node 20+)

| Command                         | What it does                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run start-run`             | Start a run: add SBOM, wait for the BOM, save as `ADDED`                             |
| `npm run tick`                  | Black Duck steps: `ADDED` → `WAITING_ADD_SYNC`, removal, 401/403 → `REMOVAL_BLOCKED` |
| `npm run verify`                | Playwright SVM checks for every due run                                              |
| `npm run notify`                | Slack/Teams summary for finished runs                                                |
| `npm run tick:all`              | `tick`, `verify`, `notify` (the hourly job)                                          |
| `npm run status`                | Print every run                                                                      |
| `npm run cleanup`               | Flag runs stuck for 24 h, unmap leftover code locations                              |
| `npm run demo`                  | Full local run against the mock                                                      |
| `npm test`, `npm run typecheck` | Tests, types                                                                         |

## Result codes

`PASS`; `FAIL` and `TIMEOUT` mean the sync is broken; `BLOCKED` (401/403 on removal) and `ERROR`
(network, token, SVM 5xx) do not count as product failures and never turn into a false `TIMEOUT`.
The SVM API decides pass or fail; the UI check is recorded as evidence and never fails a run alone.

## Documentation

| Doc                                       | For                                            |
| ----------------------------------------- | ---------------------------------------------- |
| [Beginner guide](../docs/svm-e2e-sync.md) | Concepts and worked examples                   |
| [Architecture](docs/architecture.md)      | Design, state machine, reliability rules       |
| [Configuration](docs/configuration.md)    | Every setting, variable and command            |
| [Runbook](docs/runbook.md)                | Reading results, common tasks, troubleshooting |

## Must be confirmed against your instances

The package was built from the design doc and checked only against `mock/server.ts`. These are
assumptions until `npm run spike` confirms them on the real systems:

- `blackduck.sbom_upload_path` and its query parameters (`ApiScanUploader`), or swap in Detect.
- The unmap call: `PUT /api/codelocations/{id}` with an empty `mappedProjectVersion`.
- The BOM and vulnerable-components endpoints and response shapes in `src/bd-client.ts`.
- SVM's components endpoint, response shape and asset page (`svm.*` in the settings,
  `verify/svm-api.ts`, `verify/pages/svm-asset-page.ts`, a minimal stand-in for your page objects).
- The component choices in `settings.yaml`, and whether SVM drops or only resolves removed components.

## Known limits

The JSON run store has no row locking, so run one tick at a time (the pipelines use a concurrency
group). Move `RunStore` to SQLite/Postgres if you need more.
