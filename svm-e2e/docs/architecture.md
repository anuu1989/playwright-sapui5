# Architecture

## Goal

Prove that a component and vulnerability added in Black Duck appear in SVM within the sync window
(about 8 hours), and that a removal shows up too, **without ever holding BOM delete rights**.

## Why scan-driven

The test account can scan but cannot delete BOM components. Black Duck replaces the contents of a
code location when a scan is uploaded with `mode=replace`, so:

- **add** = upload an SBOM (vulnerable component + control component) to code location `e2e-<run_id>`
- **remove** = upload an SBOM with only the control component to the **same** code location

If the replacement scan is ignored (for example as a duplicate), the fallback is to **unmap** the
code location from the project version, which takes everything that scan found out of the BOM.
Because that also drops the control component, the control check is skipped once removal went
through unmap (`expectControl` is false in that case).

## Moving parts

```text
 start pipeline (daily)      tick pipeline (hourly)
        │                          │
        ▼                          ▼
   ┌──────────────────── src/cli.ts ───────────────────┐
   │  start │ tick │ notify │ cleanup │ status           │
   └──────────┬───────────────────────────┬─────────────┘
              │                           │
      src/orchestrator.ts          verify/ (Playwright)
      Black Duck side of           SVM side of the state
      the state machine            machine, one test per due run
              │                           │
   ┌──────────┴──────────┐         ┌──────┴───────┐
   │ bd-client.ts        │         │ svm-api.ts   │ API decides pass/fail
   │ scan-uploader.ts    │         │ pages/*      │ UI check is evidence only
   │ sbom-builder.ts     │         └──────────────┘
   └─────────────────────┘
              └──────────── src/store.ts: e2e_runs (JSON file) ────────────┘
```

| Module                 | Responsibility                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `src/config.ts`        | Loads `config/settings.yaml`, validates it with zod, applies `BD_URL`/`SVM_*_URL` overrides         |
| `src/bd-client.ts`     | Black Duck REST over `fetch`: token exchange, versions, BOM, vulnerabilities, code locations, unmap |
| `src/sbom-builder.ts`  | Builds the add and remove CycloneDX SBOMs with a unique per-upload marker                           |
| `src/scan-uploader.ts` | Uploads an SBOM to a code location with `mode=replace`                                              |
| `src/store.ts`         | The `e2e_runs` table: due runs, transitions, miss/error bookkeeping                                 |
| `src/orchestrator.ts`  | `startRun`, `tick`, `removeStep`, `cleanup`                                                         |
| `src/notify.ts`        | Slack/Teams summary for finished runs                                                               |
| `verify/*`             | Playwright global setup, SVM API helper, page object, add/remove checks                             |
| `mock/server.ts`       | In-memory Black Duck + SVM used by `npm run demo` and the integration tests                         |

## Why two halves

A run lasts 16–20 hours, so it cannot be one Playwright test. The Node CLI owns the run state and
every Black Duck action. Playwright owns every SVM check, so each check gets traces, screenshots
and JUnit/HTML reports. Both read and write the same run store.

Each hourly tick is: `tick` (Black Duck steps) → `playwright test` (SVM checks for due runs) →
`notify`. No job ever sleeps for 8 hours.

## State machine

```text
ADDED ──(+8h)──▶ WAITING_ADD_SYNC ──SVM matches──▶ ADD_VERIFIED ──remove SBOM──▶ REMOVING
                    │ window closed  → ADD_TIMEOUT                                │ 401/403 → REMOVAL_BLOCKED
                    │ wrong data     → ADD_FAILED            BOM drops it ◀───────┤ no change after 60 min → unmap
                                                                  ▼
 REMOVE_VERIFIED ◀──SVM drops it── REMOVED (+8h) ── window closed → REMOVE_TIMEOUT
                                                  └─ wrong data   → REMOVE_FAILED
```

| State              | Entered when                                              | Next step by                               |
| ------------------ | --------------------------------------------------------- | ------------------------------------------ |
| `ADDED`            | Add SBOM uploaded and BOM confirmed with ≥1 vulnerability | `tick`, once `nextCheckAt` (+8h) passes    |
| `WAITING_ADD_SYNC` | The first SVM check is due                                | Playwright add check, retried every 30 min |
| `ADD_VERIFIED`     | SVM shows the component with matching vulnerabilities     | `tick` uploads the remove SBOM             |
| `REMOVING`         | Remove SBOM uploaded (or code location unmapped)          | `tick` re-reads the BOM each hour          |
| `REMOVED`          | Black Duck's BOM no longer has the component              | Playwright remove check (+8h)              |
| `REMOVE_VERIFIED`  | SVM dropped the component (final, PASS)                   | –                                          |

`REMOVING` is the one state added to the original plan: the remove SBOM is uploaded, and the BOM
is re-checked on later ticks, so no job waits on Black Duck's processing.

Final states: `REMOVE_VERIFIED`, `ADD_TIMEOUT`, `ADD_FAILED`, `REMOVAL_BLOCKED`, `REMOVE_TIMEOUT`,
`REMOVE_FAILED`.

## Result codes

| Code      | Meaning                                                        | Counts as sync failure        |
| --------- | -------------------------------------------------------------- | ----------------------------- |
| `PASS`    | Change reflected in SVM within the window                      | No                            |
| `FAIL`    | SVM shows wrong data (vulnerability mismatch, control missing) | Yes                           |
| `TIMEOUT` | Not reflected within sync wait + retry window                  | Yes                           |
| `BLOCKED` | 401/403 on removal                                             | No, flagged for follow-up     |
| `ERROR`   | Infrastructure problem (network, token, SVM 5xx)               | No, retried, alerts the owner |

An `ERROR` never changes a run's state and never counts as a miss, so an outage cannot turn into
a false `TIMEOUT`.

## Reliability rules

- **Every handler is safe to repeat.** The remove step re-reads the BOM first; a retried upload or
  a crash halfway does no harm.
- **One code location per run.** Overlapping runs cannot remove each other's components.
- **Unique SBOM per upload** (serial number, nonce, phase marker) so duplicate detection never
  skips the replacement scan.
- **The SVM UI check never fails a run alone**, so a changed locator cannot hide a working sync.
- **Responses are validated with zod.** A changed API shape fails as `ERROR`, not as a wrong `FAIL`.

## The run store

`e2e_runs` is a JSON file (`.data/e2e_runs.json`, override with `STORE_PATH`). One row per run;
see `src/types.ts` for every column. It is deliberately small and sits behind `RunStore`, so it can
move to SQLite or Postgres without touching callers. It has no row locking: run one tick at a time.
In CI, `scripts/state.sh` keeps the file on the orphan branch `svm-e2e-state` between scheduled runs.

## What is and isn't verified

`npm test` (unit + HTTP integration against `mock/server.ts`) and `npm run demo` prove the state
machine, the HTTP client, the SBOM handling and the Playwright specs are consistent with each
other. They do **not** prove the real Black Duck or SVM behave like the mock. The endpoints, the
unmap call and SVM's response shape are assumptions until the Phase 0 spikes confirm them. See
[the README](../README.md#must-be-confirmed-against-your-instances).
