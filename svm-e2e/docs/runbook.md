# Runbook

For whoever owns the test once it runs unattended.

## Phase 0 spike: validate against your real systems

Everything in this package was built from the design doc and tested against a mock. Before the
first real run, `npm run spike` checks each assumption against your Black Duck and SVM with your
own tokens, and writes `results/spike-report.md`.

```bash
export BD_URL=https://blackduck.your-company.internal
export BD_API_TOKEN=...                 # the scan-only service account
export SVM_API_URL=...  SVM_UI_URL=...  SVM_API_TOKEN=...
npm run spike                           # add --no-svm to check Black Duck only, --keep to skip the unmap
```

It only touches the test project: it creates a version and code location named `e2e-spike-<time>`,
uploads the add SBOM and then the remove SBOM, and unmaps the code location at the end.

| Step                               | What a FAIL tells you                                                            | Fix                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| authenticate                       | Wrong URL or token, or the account is denied                                     | Check `BD_URL` and the token; set `NODE_EXTRA_CA_CERTS` for a private CA                                                   |
| test project and version           | The project `svm-e2e-sync` does not exist, or the account cannot create versions | Create the project; grant version creation on it                                                                           |
| upload add SBOM                    | Wrong endpoint or content type, or no scan rights                                | Adjust `blackduck.sbom_upload_path` and `sbom_content_type` (check `/api-doc`), or implement a Detect-based `ScanUploader` |
| BOM built                          | Black Duck did not match the component from the SBOM                             | Pick another component or a different `purl` in `settings.yaml`                                                            |
| vulnerabilities listed             | No vulnerabilities known for that component version                              | Pick a component with long-standing vulnerabilities                                                                        |
| replace scan removes the component | Duplicate detection or a minimum scan interval is on                             | Ask the Black Duck admin; raise `removal_fallback_after_minutes` above the interval                                        |
| unmap allowed                      | The account lacks unmap rights                                                   | Ask for the smallest role that allows it, or use a cleanup service (option B)                                              |
| SVM API components                 | Wrong path, auth or response shape                                               | Adjust `svm.components_path` and the schema in `verify/svm-api.ts`                                                         |
| SVM UI asset page                  | Wrong path, or a login redirect                                                  | Adjust `svm.asset_ui_path`; provide `SVM_UI_STORAGE_STATE`                                                                 |

The last row of the report is not a check: ask the SVM owner whether 8 hours is a maximum or a
typical figure, and whether SVM drops a component that leaves the BOM or only marks it resolved.
The removal assertion depends on the answer.

Exit criterion: one manual add and one manual remove done end to end, with the API calls written
down. Then choose option A (replace scan), A2 (unmap) or B (cleanup service).

## Daily glance

`npm run status` prints one line per run:

```text
PASS e2e-20261009-0600-ab12cd (REMOVE_VERIFIED) | component log4j-core@2.14.1 | add: PASS (sync delay 8.3h) | remove: PASS via scan_replace (sync delay 8.1h)
```

The sync delay is the real time SVM took to show each change. Watch it drift; if it creeps toward
`sync_wait_hours + retry_window_hours`, widen the window before it starts failing.

Reports: `results/junit.xml` and `playwright-report/` (uploaded as the `svm-e2e-reports` artifact).
Playwright traces and screenshots are kept for failed checks.

## Reading a result

| Final state       | Meaning                                                                  | What to do                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `REMOVE_VERIFIED` | Add and removal both reached SVM                                         | Nothing                                                                                                                                  |
| `ADD_TIMEOUT`     | SVM never showed the component                                           | Sync is broken or slower than the window. Check SVM's sync job first, then raise `retry_window_hours` if the real delay is simply longer |
| `ADD_FAILED`      | SVM shows the component but with different vulnerabilities               | Compare `vulnIds` in the run with what SVM returned (`evidence.failure`)                                                                 |
| `REMOVAL_BLOCKED` | The account was denied (401/403) during removal                          | The add result still counts. Ask the Black Duck admin for scan-upload and unmap rights, or fall back to a cleanup service                |
| `REMOVE_TIMEOUT`  | SVM still shows a component Black Duck dropped                           | Either sync did not propagate the removal, or SVM marks components resolved instead of dropping them. Ask the SVM owner which            |
| `REMOVE_FAILED`   | The component is gone but the control is missing too (replace scan path) | SVM lost the whole asset                                                                                                                 |

An `ERROR` is not a result: the run keeps its state, retries, and `evidence.lastError` holds the
message.

## Common tasks

**Start a run on demand.** Trigger the `svm-e2e-start` workflow, or `npm run start-run` locally.

**Rerun a step.** Edit the run in `.data/e2e_runs.json` (locally) or on the `svm-e2e-state` branch
(CI): set `state` back (for example `WAITING_ADD_SYNC`), set `nextCheckAt` to a past time, clear
the result field, and run `npm run verify`.

**A run is stuck.** `npm run cleanup` lists runs with no progress for `stuck_after_hours`. Fix the
cause, then rerun the step as above, or delete the row.

**Rotate a token.** Replace the secret in the CI secret store. A bad token shows as `BLOCKED`/`ERROR`
on the very next tick, for every run at once; alert on the first.

**Clean up Black Duck.** Test code locations are named `e2e-<run_id>`. `npm run cleanup` unmaps
leftovers of failed runs. Whole versions can be removed by the Black Duck admin.

**Move the run store to a database.** Implement the `RunStore` methods against SQLite or Postgres
(row locking with `SELECT … FOR UPDATE SKIP LOCKED`) and keep the signatures.

## Troubleshooting

| Symptom                                                      | Cause and fix                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Missing required environment variable`                      | Export the secret named in the message                                                                                                            |
| `Black Duck project "…" not found`                           | Create the test project first                                                                                                                     |
| `no vulnerabilities for <component>` at start                | Black Duck did not match or has none for that component; choose another in `components`                                                           |
| Spike step fails                                             | See the table in "Phase 0 spike" above                                                                                                            |
| `Unexpected Black Duck response` / `Unexpected SVM response` | An API changed shape or the spike assumptions were wrong; adjust the zod schema in `src/bd-client.ts` or `verify/svm-api.ts`                      |
| Playwright "No tests found"                                  | No run is due this hour; `npm run verify` treats that as success                                                                                  |
| Every run `ERROR` at once                                    | Token expired or lost scope, or Black Duck/SVM is down                                                                                            |
| Remove never happens and the unmap fallback keeps firing     | Duplicate detection or a minimum scan interval is on. Ask the Black Duck admin; raise `removal_fallback_after_minutes` above the minimum interval |
| UI check fails but the run passes                            | By design; fix the locators in `verify/pages/svm-asset-page.ts`                                                                                   |
| TLS errors against an internal host                          | Set `NODE_EXTRA_CA_CERTS` to your CA bundle                                                                                                       |
