# Architecture

## Goal

> The diagrams below are Mermaid, which GitHub renders. If your viewer does not, static copies are in
> [diagrams/](diagrams): [overview](diagrams/overview.png), [run flow](diagrams/run-flow.png),
> [removal](diagrams/removal.png), [tick](diagrams/tick.png), [run timeline](diagrams/run-timeline.png)
> and [state machine](diagrams/state-machine.png). To regenerate them after editing a diagram:
> `npx @mermaid-js/mermaid-cli -i diagram.mmd -o diagram.png`.

Prove that a component and vulnerability added in Black Duck appear in SVM within the sync window
(about 8 hours), and that a removal shows up too, **without ever holding BOM delete rights**.

## The big picture

The test checks that **Black Duck's data reaches SVM**, so it only ever _writes_ to Black Duck and
only ever _reads_ from SVM. The sync between them (about 8 hours) is the thing under test.

```mermaid
flowchart LR
    subgraph SCHED["1. Schedulers - GitHub Actions"]
        direction TB
        START["start pipeline<br/>daily or on demand"]
        TICK["tick pipeline<br/>every 30 minutes"]
    end

    subgraph TEST["2. The test - svm-e2e"]
        direction TB
        CLI["CLI<br/>src/cli.ts"]
        ORCH["Orchestrator<br/>every Black Duck action"]
        PW["Playwright<br/>every SVM check"]
        NOTIFY["Notifier<br/>finished runs"]
        STORE[("Run store<br/>one row per run")]
    end

    subgraph BDSYS["3. Black Duck - written to"]
        BD["REST API<br/>SBOM upload, BOM,<br/>vulnerabilities, code locations"]
    end

    subgraph SVMSYS["4. SVM - only read"]
        direction TB
        SVMAPI["SVM API"]
        SVMUI["SVM UI"]
    end

    SLACK["Slack / Teams"]

    START --> CLI
    TICK --> CLI
    CLI --> ORCH
    CLI --> PW
    CLI --> NOTIFY
    ORCH <--> STORE
    PW <--> STORE
    NOTIFY <--> STORE
    ORCH -- "upload SBOM,<br/>read BOM" --> BD
    BD -. "sync, about 8 h<br/>= the thing under test" .-> SVMAPI
    PW -- "components" --> SVMAPI
    PW -- "asset page" --> SVMUI
    NOTIFY --> SLACK

    classDef sched fill:#fff8e1,stroke:#f9a825,color:#1b1b1b
    classDef bd fill:#e8f5e9,stroke:#2e7d32,color:#1b1b1b
    classDef svm fill:#e3f2fd,stroke:#1565c0,color:#1b1b1b
    classDef core fill:#f3e5f5,stroke:#6a1b9a,color:#1b1b1b
    class START,TICK sched
    class BD,ORCH bd
    class SVMAPI,SVMUI,PW svm
    class CLI,NOTIFY,STORE,SLACK core
```

**How to read it.**

- **1. Schedulers.** Two small GitHub Actions pipelines drive everything. `start` creates a run;
  `tick` moves existing runs forward. Neither ever waits for the 8-hour sync.
- **2. The test.** One CLI dispatches to two halves: the **Orchestrator** does every Black Duck
  action, and **Playwright** does every SVM check. They never call each other; they only read and write
  the **run store**, which is the single source of truth about where each run is.
- **3. Black Duck** is only written to (SBOM uploads) and read back (BOM, vulnerabilities).
  **4. SVM** is only read. The dotted arrow is Black Duck's own sync, which this test
  exists to prove.
- **Why two halves.** A run lasts 16-20 hours, so it cannot be one Playwright test. Playwright still
  owns the SVM checks so every check gets traces, screenshots and JUnit/HTML reports.

## One run, end to end

This is the team's flowchart, with the removal done through scans. Green boxes are the Black Duck
side, blue boxes are the SVM side, and the amber boxes are where the run waits.

```mermaid
flowchart TD
    A["1. Find a vulnerable component<br/>try the candidates in settings.yaml in order"]
    B["2. Add it to Black Duck<br/>upload add SBOM to code location e2e-RUN_ID"]
    C{"3. Black Duck assessment OK?<br/>component + control + at least one vulnerability"}
    D["4. Save the test transaction<br/>run_id, component_id, vuln_ids, state ADDED"]
    E(["5. Wait 8 hours<br/>nextCheckAt - nothing sleeps"])
    F["6. Tick triggers verification<br/>next scheduled tick after the run is due"]
    G["7. SVM API check<br/>component present, vulnerabilities match"]
    H["8. SVM UI check<br/>component row visible on the asset page"]
    I{"ADD TEST = PASS?<br/>API and UI both pass"}
    J["9. Remove from Black Duck<br/>replace scan without the component,<br/>else unmap the code location"]
    K{"10. Black Duck BOM no longer<br/>has the component?"}
    L(["11. Wait 8 hours"])
    M["12. Tick triggers verification"]
    N["13. SVM API check<br/>component absent, control still present"]
    O["14. SVM UI check<br/>component row gone"]
    P{"DELETE TEST = PASS?"}
    Q(["Next cycle<br/>cycle.mode: continuous"])

    X1["ADD_TIMEOUT or ADD_FAILED<br/>loop stops"]
    X2["REMOVAL_BLOCKED<br/>401 or 403 - add result kept"]
    X3["REMOVE_TIMEOUT or REMOVE_FAILED<br/>loop stops"]

    A --> B --> C
    C -- "no: next candidate" --> A
    C -- yes --> D --> E --> F
    F --> G
    F --> H
    G --> I
    H --> I
    I -- "yes: ADD_VERIFIED" --> J
    I -- "no, retry every 30 min inside the window" --> F
    I -- "window closed" --> X1
    J --> K
    K -- "yes: REMOVED" --> L --> M
    K -- "denied" --> X2
    M --> N
    M --> O
    N --> P
    O --> P
    P -- "yes: REMOVE_VERIFIED" --> Q
    P -- "no, retry every 30 min inside the window" --> M
    P -- "window closed" --> X3
    Q -.-> A

    classDef bd fill:#e8f5e9,stroke:#2e7d32,color:#1b1b1b
    classDef svm fill:#e3f2fd,stroke:#1565c0,color:#1b1b1b
    classDef wait fill:#fff8e1,stroke:#f9a825,color:#1b1b1b
    classDef bad fill:#ffebee,stroke:#c62828,color:#1b1b1b
    classDef good fill:#e8f5e9,stroke:#2e7d32,stroke-width:3px,color:#1b1b1b
    class A,B,C,D,J,K bd
    class F,G,H,M,N,O,I,P svm
    class E,L wait
    class X1,X2,X3 bad
    class Q good
```

**How to read it.**

| Steps        | What happens                                                                                                                                                                                                                                 | Who does it                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1-4          | Pick a component, add it, check Black Duck really reports it with a vulnerability, and save the run. If a candidate has no vulnerabilities, the next one is tried.                                                                           | `startRun` (Orchestrator)     |
| 5            | The run is saved with `nextCheckAt` = now + 8 hours. No process sleeps.                                                                                                                                                                      | the run store                 |
| 6-8          | At the first scheduled tick after the run is due, Playwright checks SVM's API and its UI.                                                                                                                                                    | `tick:all`, `verify/phase.ts` |
| add decision | Both checks must pass. A miss is retried every 30 minutes until the window (8 h + 2 h) closes, then it is a timeout.                                                                                                                         | `store.recordMiss`            |
| 9-10         | Remove through scans: the SBOM without the component goes to the same code location. If the BOM still has the component after 60 minutes, the code location is unmapped. A 401/403 stops here as `REMOVAL_BLOCKED` and keeps the add result. | `removeStep`                  |
| 11-14        | The same wait and the same two SVM checks, now expecting the component to be gone and the control to remain.                                                                                                                                 | `tick:all`, `verify/phase.ts` |
| next cycle   | After `REMOVE_VERIFIED`, the next tick starts a new run. A failed run stops the loop until someone looks at it.                                                                                                                              | `maybeStartNext`              |

## Why scan-driven

The test account can scan but cannot delete BOM components. Black Duck replaces the contents of a
code location when a scan is uploaded with `mode=replace`, so:

- **add** = upload an SBOM (vulnerable component + control component) to code location `e2e-<run_id>`
- **remove** = upload an SBOM with only the control component to the **same** code location

If the replacement scan is ignored (for example as a duplicate), the fallback is to **unmap** the
code location from the project version, which takes everything that scan found out of the BOM.
Because that also drops the control component, the control check is skipped once removal went
through unmap (`expectControl` is false in that case).

```mermaid
flowchart TD
    R(["Add test passed - remove the component"])
    U1["Upload the SBOM without the component<br/>to the same code location, mode=replace"]
    D1{"Upload allowed?"}
    BLK["REMOVAL_BLOCKED<br/>add result kept"]
    W{"BOM no longer has the component<br/>within 60 minutes?"}
    UM["Fallback: unmap the code location<br/>from the project version"]
    D2{"Unmap allowed?"}
    OK1(["REMOVED via scan_replace<br/>control component must remain"])
    OK2(["REMOVED via scan_unmap<br/>control is dropped too, so it is not required"])

    R --> U1 --> D1
    D1 -- "401 or 403" --> BLK
    D1 -- yes --> W
    W -- yes --> OK1
    W -- "no: replace scan ignored,<br/>for example as a duplicate" --> UM --> D2
    D2 -- "401 or 403" --> BLK
    D2 -- yes --> OK2
```

**How to read it.** Removal never deletes anything. It first tries the replace scan, which needs scan
rights only. If Black Duck ignores it, unmapping is the fallback. If neither is allowed the run ends as
`REMOVAL_BLOCKED`, which is reported separately from a product failure.

## Mapping to the flowchart

The run follows the team's flowchart step for step. The one deliberate difference is how the
component is removed (see "Why scan-driven").

| Flowchart step                                           | Where it happens                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test orchestrator                                        | `src/cli.ts`, `src/orchestrator.ts`                                                                                                                                      |
| Find vulnerable component                                | `startRun` tries the candidates in `components` in order until Black Duck reports a vulnerability                                                                        |
| Add component to Black Duck                              | `startRun` uploads the add SBOM (scan upload instead of a manual add)                                                                                                    |
| Verify Black Duck assessment (component + vulnerability) | `startRun` waits for the BOM, then needs the component, the control and at least one vulnerability                                                                       |
| Save test transaction (run_id / component_id / vuln_id)  | The `ADDED` row: `runId`, `componentVersionId`, `vulnIds`                                                                                                                |
| Wait 8 hours                                             | `nextCheckAt`: nothing sleeps                                                                                                                                            |
| Trigger verification pipeline                            | The scheduled `tick:all` job (every 30 min), once the run is due                                                                                                         |
| SVM API check and SVM UI check                           | `verify/phase.ts`                                                                                                                                                        |
| ADD TEST = PASS                                          | The run becomes `ADD_VERIFIED`: both checks passed (`svm.ui_check_gates`)                                                                                                |
| Delete manually-added BOM component                      | **Different on purpose:** `removeStep` uploads the SBOM without the component (replace scan), else unmaps the code location. No BOM delete rights are needed             |
| Verify Black Duck deleted                                | `removeStep` re-reads the BOM until the component is gone                                                                                                                |
| Wait 8 hours, trigger pipeline, API + UI checks          | Same as the add side, on the `REMOVED` state                                                                                                                             |
| DELETE TEST = PASS                                       | The run becomes `REMOVE_VERIFIED`                                                                                                                                        |
| Repeat for next cycle                                    | `maybeStartNext`: with `cycle.mode: continuous` the next run starts on the first tick after the latest run passed. A failed run stops the loop until someone looks at it |

## Modules

The code, grouped the same way as the diagram above.

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

## What one scheduled tick does

The tick pipeline runs every 30 minutes, which is also the retry cadence. Most ticks find nothing
due and stop in the first few seconds.

```mermaid
flowchart TD
    S(["Scheduled tick - every 30 minutes"])
    P1["Restore the run store<br/>scripts/state.sh pull"]
    P2{"npm run plan<br/>anything due?"}
    IDLE(["Stop - nothing installed,<br/>no network calls"])
    INST["Install Playwright browsers<br/>cached; only if an SVM check is due"]
    T["npm run tick - Black Duck steps"]
    T1["ADDED and due: move to WAITING_ADD_SYNC"]
    T2["ADD_VERIFIED: upload the remove SBOM"]
    T3["REMOVING: re-read the BOM, unmap after 60 min"]
    T4["Latest run passed: start the next cycle"]
    Q{"SVM check due?"}
    PWR["Playwright - one test per due run<br/>API check, then UI check"]
    N["npm run notify<br/>Slack summary for finished runs"]
    SAVE["Save the run store<br/>scripts/state.sh push"]
    DONE(["Done - exit code is Playwright's"])

    S --> P1 --> P2
    P2 -- "no" --> IDLE
    P2 -- "yes" --> INST --> T
    T --> T1
    T --> T2
    T --> T3
    T --> T4
    T1 --> Q
    T2 --> Q
    T3 --> Q
    T4 --> Q
    Q -- "no" --> N
    Q -- "yes" --> PWR --> N
    N --> SAVE --> DONE
```

**How to read it.** `plan` looks only at the run store, so it needs no secrets and no network. When
work exists, `tick` does every Black Duck step that is due, then Playwright runs only if an SVM check
is due, then finished runs are announced and the store is saved back. Every step is safe to repeat,
so a failed or cancelled tick is simply redone by the next one.

## A run over time

How the pieces talk to each other across the roughly 16-20 hours of one run.

```mermaid
sequenceDiagram
    autonumber
    participant ST as Start pipeline
    participant RS as Run store
    participant BD as Black Duck
    participant TK as Tick pipeline
    participant PW as Playwright
    participant SV as SVM

    ST->>BD: Upload add SBOM to code location e2e-RUN_ID
    ST->>BD: Poll until the BOM has the component and a vulnerability
    ST->>RS: Save run as ADDED, due in 8 hours
    Note over BD,SV: Black Duck syncs to SVM, about 8 hours. Ticks find nothing due.
    TK->>RS: Plan - the run is due
    TK->>RS: ADDED becomes WAITING_ADD_SYNC
    TK->>PW: Run the add check
    PW->>SV: API: component present with matching vulnerabilities
    PW->>SV: UI: component row visible
    PW->>RS: ADD_VERIFIED
    TK->>BD: Upload remove SBOM, same code location
    TK->>RS: REMOVING
    TK->>BD: Read the BOM - component gone
    TK->>RS: REMOVED, due in 8 hours
    Note over BD,SV: Black Duck syncs the removal to SVM, about 8 hours.
    TK->>PW: Run the remove check
    PW->>SV: API: component absent, control present
    PW->>SV: UI: component row gone
    PW->>RS: REMOVE_VERIFIED
    TK->>BD: Next cycle - start a new run
```

**How to read it.** Read top to bottom: time passes down the page. The two grey notes are the long
waits; everything else takes seconds. Black Duck is only ever written by the start and tick
pipelines, and SVM is only ever read by Playwright.

## State machine

Every run is one row in the run store, and its `state` says which step is next. The tick pipeline
moves it forward when `nextCheckAt` has passed.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> ADDED: start-run uploads the add SBOM
    ADDED --> WAITING_ADD_SYNC: 8 hours passed
    WAITING_ADD_SYNC --> ADD_VERIFIED: SVM API and UI both match
    WAITING_ADD_SYNC --> WAITING_ADD_SYNC: retry in 30 min
    WAITING_ADD_SYNC --> ADD_TIMEOUT: window closed
    WAITING_ADD_SYNC --> ADD_FAILED: wrong vulnerabilities

    ADD_VERIFIED --> REMOVING: remove SBOM uploaded
    ADD_VERIFIED --> REMOVAL_BLOCKED: 401 or 403
    REMOVING --> REMOVING: unmap after 60 min
    REMOVING --> REMOVAL_BLOCKED: 401 or 403
    REMOVING --> REMOVED: BOM drops it

    REMOVED --> REMOVE_VERIFIED: SVM dropped it
    REMOVED --> REMOVED: retry in 30 min
    REMOVED --> REMOVE_TIMEOUT: window closed
    REMOVED --> REMOVE_FAILED: control missing too

    REMOVE_VERIFIED --> [*]: PASS - next cycle starts
    ADD_TIMEOUT --> [*]
    ADD_FAILED --> [*]
    REMOVAL_BLOCKED --> [*]
    REMOVE_TIMEOUT --> [*]
    REMOVE_FAILED --> [*]
```

**How to read it.** The happy path is the straight line down the left:
`ADDED` → `WAITING_ADD_SYNC` → `ADD_VERIFIED` → `REMOVING` → `REMOVED` → `REMOVE_VERIFIED`. Arrows
that loop back on a state are retries. Everything that ends at the bottom without `REMOVE_VERIFIED`
is a final state that needs a human; in continuous mode it stops the loop.

| State              | Entered when                                              | Next step by                                |
| ------------------ | --------------------------------------------------------- | ------------------------------------------- |
| `ADDED`            | Add SBOM uploaded and BOM confirmed with ≥1 vulnerability | `tick`, once `nextCheckAt` (+8h) passes     |
| `WAITING_ADD_SYNC` | The first SVM check is due                                | Playwright add check, retried every 30 min  |
| `ADD_VERIFIED`     | SVM shows the component with matching vulnerabilities     | `tick` uploads the remove SBOM              |
| `REMOVING`         | Remove SBOM uploaded (or code location unmapped)          | `tick` re-reads the BOM every tick (30 min) |
| `REMOVED`          | Black Duck's BOM no longer has the component              | Playwright remove check (+8h)               |
| `REMOVE_VERIFIED`  | SVM dropped the component (final, PASS)                   | –                                           |

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

## Efficiency

The test waits far more than it works, so the design avoids paying for the waiting:

- **Plan before doing anything.** `npm run plan` decides from the run store alone whether a tick has
  Black Duck steps, SVM checks or notifications to do. The pipeline runs it first, and an idle tick
  (most of them) stops there: no browser install, no Black Duck or SVM calls.
- **Playwright only when an SVM check is due.** `tick:all` skips it otherwise, so no browser starts
  up for nothing. Browsers are cached between pipeline runs.
- **The tick matches the retry cadence.** The pipeline runs every 30 minutes, the same as
  `retry_every_minutes`; an hourly tick would silently turn "retry every 30 minutes" into every hour.
- **One browser per Playwright file, one SVM call per project.** All due runs share a browser (each
  gets its own context) and a 30-second cache of SVM's component list.
- **Optional early probing.** `timing.first_check_after_hours` can be lower than the sync wait. A pass
  shortens the cycle and records the true sync delay; a miss only retries. The `TIMEOUT` deadline is
  unchanged.

## Reliability rules

- **Every handler is safe to repeat.** The remove step re-reads the BOM first; a retried upload or
  a crash halfway does no harm.
- **One code location per run.** Overlapping runs cannot remove each other's components.
- **Unique SBOM per upload** (serial number, nonce, phase marker) so duplicate detection never
  skips the replacement scan.
- **The SVM UI check gates the pass by default** (`svm.ui_check_gates: true`), as in the flowchart: an API pass with a failing UI is retried like any other miss and ends as a timeout. If locators are flaky, set it to `false` and the UI result becomes evidence only, so a changed locator cannot hide a working sync.
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
