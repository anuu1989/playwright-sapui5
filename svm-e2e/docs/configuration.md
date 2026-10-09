# Configuration reference

## `config/settings.yaml`

Validated with zod at startup; a bad value fails immediately with the field name.

| Key                                     | Default           | Meaning                                                                                    |
| --------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `blackduck.url`                         | –                 | Black Duck base URL. Overridden by `BD_URL`                                                |
| `blackduck.project`                     | –                 | Test project. Must already exist                                                           |
| `blackduck.version_strategy`            | `per_run`         | `per_run` creates a version named after the run; `shared` reuses `shared_version`          |
| `blackduck.shared_version`              | `e2e-shared`      | Version used when the strategy is `shared`                                                 |
| `blackduck.sbom_upload_path`            | `/api/scan/data/` | SBOM upload endpoint. **Confirm in your `/api-doc`**                                       |
| `svm.api_url` / `svm.ui_url`            | –                 | SVM API and UI base URLs. Overridden by `SVM_API_URL` / `SVM_UI_URL`                       |
| `svm.components_path`                   | –                 | SVM endpoint returning the asset's components; `{project}` is replaced by the project name |
| `svm.asset_ui_path`                     | –                 | SVM UI page for the asset; `{project}` is replaced likewise                                |
| `timing.sync_wait_hours`                | `8`               | First SVM check is this long after each change                                             |
| `timing.retry_every_minutes`            | `30`              | Gap between retries inside the window                                                      |
| `timing.retry_window_hours`             | `2`               | Extra time after the sync wait before `TIMEOUT`                                            |
| `timing.bom_ready_timeout_minutes`      | `30`              | How long `start-run` waits for Black Duck to build the BOM                                 |
| `timing.removal_fallback_after_minutes` | `60`              | Unmap the code location if the replace scan has not removed the component by then          |
| `timing.stuck_after_hours`              | `24`              | `cleanup` flags runs with no progress for this long                                        |
| `components`                            | –                 | Component(s) under test; the first is used, the rest are backups to swap in by hand        |
| `control_component`                     | –                 | Harmless component that must stay present                                                  |

Pick components Black Duck reliably matches from an SBOM and that have long-standing, high-severity
vulnerabilities. Assertions use "at least one shared vulnerability", never a fixed ID, so a
re-scored vulnerability does not cause a false failure.

## Environment variables

| Variable                    | Required     | Purpose                                                                              |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `BD_API_TOKEN`              | yes          | Black Duck API token for a service account with scan rights on the test project only |
| `BD_URL`                    | no           | Overrides `blackduck.url` (internal deployments)                                     |
| `SVM_API_TOKEN`             | for `verify` | Read-only SVM API token                                                              |
| `SVM_API_URL`, `SVM_UI_URL` | no           | Override `svm.api_url` / `svm.ui_url`                                                |
| `SVM_UI_STORAGE_STATE`      | no           | Path to a Playwright `storageState` file so UI checks start signed in                |
| `SLACK_WEBHOOK_URL`         | no           | Slack/Teams incoming webhook; summaries are printed when unset                       |
| `STORE_PATH`                | no           | Run store location (default `.data/e2e_runs.json`)                                   |
| `SVM_E2E_CONFIG`            | no           | Alternative settings file (the demo uses `config/mock.yaml`)                         |
| `STATE_BRANCH`              | no           | Branch `scripts/state.sh` uses to persist the store in CI (default `svm-e2e-state`)  |
| `NODE_EXTRA_CA_CERTS`       | no           | Path to your private CA bundle if the internal servers use one                       |

Tokens belong in your CI secret store, never in the repo or the YAML.

## CLI

| Command                         | Does                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run start-run`             | Create a run: upload the add SBOM, wait for the BOM, save as `ADDED`                        |
| `npm run tick`                  | Black Duck steps for every due run                                                          |
| `npm run verify`                | Playwright SVM checks for every due run (passes when none are due)                          |
| `npm run notify`                | Post a summary per finished run                                                             |
| `npm run tick:all`              | `tick`, then `verify`, then `notify`; exits non-zero if a check failed                      |
| `npm run status`                | Print every run                                                                             |
| `npm run cleanup`               | Flag stuck runs (exit code 1) and unmap leftover code locations                             |
| `npm run demo`                  | Full local run against the mock; `-- --ignore-replace` and `-- --block` for the other paths |
| `npm test`, `npm run typecheck` | Unit and integration tests, types                                                           |
