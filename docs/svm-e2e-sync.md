# Black Duck → SVM sync test: a beginner's guide

This guide explains the [`svm-e2e/`](../svm-e2e) package from scratch, with examples you can run
without touching Black Duck or SVM.

> The Black Duck and SVM endpoints in this package are written from the design doc and have **not
> been verified against live systems**. Everything in "Try it offline" runs for real; the
> "Run it for real" part needs the setup spikes in [Before the first real run](#before-the-first-real-run).

## The idea in one minute

**Black Duck** scans software and lists the open-source components it finds (a _BOM_). **SVM**
shows those components and their vulnerabilities, and gets its data from Black Duck by a sync that
takes about 8 hours.

This test proves the sync works, in both directions:

1. **Add:** put a vulnerable component into Black Duck. About 8 hours later it should appear in SVM.
2. **Remove:** take that component out of Black Duck. About 8 hours later it should disappear from SVM.

Because of the waiting, one test run takes 16–20 hours. So nothing sleeps. Each run is a row in a
small file, and a job that runs **every hour** looks at the file and moves any run that is due to
its next step.

The test account cannot delete BOM components, so it never deletes. It adds a component by
**uploading a small SBOM file** (a list of components) and removes it by **uploading the same file
again without that component** to the same _code location_. Black Duck replaces the contents of a
code location, so the component drops off the BOM. This needs scan rights only.

## Words you will see

| Word              | Meaning                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BOM               | The list of components Black Duck has for a project version                                                                                                                                                                                |
| SBOM              | A file listing components (this package uses CycloneDX JSON)                                                                                                                                                                               |
| Code location     | The named place a scan is stored. Each run has its own: `e2e-<run_id>`                                                                                                                                                                     |
| Run               | One add-then-remove test, saved as one row in `.data/e2e_runs.json`                                                                                                                                                                        |
| Control component | A harmless component kept in both SBOMs. If it vanishes from SVM too, SVM lost the whole asset and "component absent" would be a false pass. After the unmap fallback it is dropped along with everything else, so it is not required then |
| Tick              | The hourly job that advances due runs                                                                                                                                                                                                      |

## The life of a run

```text
ADDED ──8h──▶ WAITING_ADD_SYNC ──SVM shows it──▶ ADD_VERIFIED
                  │ not seen in window → ADD_TIMEOUT          │ remove SBOM uploaded
                  │ wrong data         → ADD_FAILED           ▼
                                                           REMOVING ── 403/401 → REMOVAL_BLOCKED
                                                              │ BOM no longer has it
                                                              ▼
REMOVE_VERIFIED ◀──SVM dropped it── REMOVED (wait 8h)
   (PASS)         │ still there → REMOVE_TIMEOUT
                  │ wrong data  → REMOVE_FAILED
```

Only `FAIL`/`TIMEOUT` outcomes mean the sync is broken. `BLOCKED` (permission denied) and `ERROR`
(network, expired token) are reported separately so they don't look like product bugs.

## See the whole thing run: `npm run demo`

The quickest way to understand the package. It starts a local mock Black Duck and SVM, then runs
the **real** CLI and the **real** Playwright specs against them, with timings shrunk from hours to
seconds.

```bash
cd svm-e2e
npm ci
npx playwright install chromium
npm run demo
```

Output from a real run (the numbers in brackets are seconds since the run started):

```text
[e2e-20261009-0234-k404x8] add SBOM uploaded
[e2e-20261009-0234-k404x8] ADDED, 1 vulnerabilities, first SVM check at 2026-10-09T02:34:42.081Z
[  1s] ADDED
[  4s] WAITING_ADD_SYNC
[  6s] ADD_VERIFIED
[e2e-20261009-0234-k404x8] remove SBOM uploaded
[  9s] REMOVING (removal: scan_replace)
[ 11s] REMOVED (removal: scan_replace)
[ 14s] REMOVE_VERIFIED (removal: scan_replace)

PASS e2e-20261009-0234-k404x8 (REMOVE_VERIFIED) | component log4j-core@2.14.1 | add: PASS | remove: PASS via scan_replace
```

Two more scenarios cover the unhappy paths:

```bash
npm run demo -- --ignore-replace   # Black Duck ignores the replacement scan
npm run demo -- --block            # the account is denied on removal
```

With `--ignore-replace` the run notices the component is still in the BOM, unmaps the code
location, and still passes:

```text
[ 11s] REMOVING (removal: scan_replace)
[e2e-20261009-0235-zhc4fu] replace scan did not remove the component; unmapped code location (A2)
[ 28s] REMOVED (removal: scan_unmap)
[ 31s] REMOVE_VERIFIED (removal: scan_unmap)
```

With `--block` the add still passes, and the denied removal is reported as `BLOCKED`, not as a
product failure:

```text
[  6s] ADD_VERIFIED
[e2e-20261009-0236-uhmvb3] removal BLOCKED (403)
[  9s] REMOVAL_BLOCKED
BLOCKED e2e-20261009-0236-uhmvb3 (REMOVAL_BLOCKED) | component log4j-core@2.14.1 | add: PASS | remove: BLOCKED via none
```

The mock lives in `svm-e2e/mock/server.ts`. It proves the code is consistent with itself, not that
the real Black Duck or SVM behave the same way.

## Try it offline (no accounts needed)

You need Node 20+.

```bash
cd svm-e2e
npm ci
npm test            # unit tests plus HTTP integration tests against the mock
npm run typecheck
```

### Example 1: watch a whole Black Duck side lifecycle

The tests use a fake Black Duck and a fake clock, so you can fast-forward hours. Save this as
`svm-e2e/test/demo.ts` and run it with `node_modules/.bin/tsx test/demo.ts` (delete it afterwards):

```ts
import { startRun, tick } from '../src/orchestrator';
import { summarize } from '../src/notify';
import { setup } from './helpers';

async function main() {
  const { deps, store, advance } = setup(); // fake Black Duck + fake clock
  const d = { ...deps, log: (m: string) => console.log(m) };

  const run = await startRun(d); // upload add SBOM, save run as ADDED
  advance(8 * 3_600_000); // fast-forward 8 hours
  await tick(d); // ADDED -> WAITING_ADD_SYNC
  store.transition(run.runId, 'ADD_VERIFIED', { addResult: 'PASS' }); // what the Playwright add test does
  await tick(d); // uploads the remove SBOM
  advance(5 * 60_000);
  await tick(d); // BOM confirms the component is gone
  console.log(summarize(store.get(run.runId)!));
}
main();
```

Output from a real run of that script:

```text
[e2e-20260101-0000-v5pldo] add SBOM uploaded
[e2e-20260101-0000-v5pldo] ADDED, 1 vulnerabilities, first SVM check at 2026-01-01T08:00:00.000Z
[e2e-20260101-0000-v5pldo] ADDED -> WAITING_ADD_SYNC
[e2e-20260101-0000-v5pldo] remove SBOM uploaded
[e2e-20260101-0000-v5pldo] REMOVED via scan_replace, first SVM check at +8h
PENDING e2e-20260101-0000-v5pldo (REMOVED) | component log4j-core@2.14.1 | add: PASS (sync delay n/a) | remove: - via scan_replace (sync delay n/a)
```

`PENDING` is expected: the run is now `REMOVED` and waits another 8 hours for the SVM remove check.

### Example 2: what the two SBOMs look like

`buildAddSbom` lists the vulnerable component and the control. `buildRemoveSbom` lists only the
control. Both carry a unique marker so Black Duck never skips the second upload as a duplicate.

```jsonc
// add SBOM (abridged)
{ "bomFormat": "CycloneDX", "specVersion": "1.5",
  "metadata": { "properties": [{ "name": "e2e:phase", "value": "add" }, /* run id, nonce */] },
  "components": [
    { "name": "log4j-core", "version": "2.14.1", "purl": "pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1" },
    { "name": "slf4j-api",  "version": "1.7.36", "purl": "pkg:maven/org.slf4j/slf4j-api@1.7.36" } ] }

// remove SBOM: same code location, vulnerable component gone
{ ..., "components": [ { "name": "slf4j-api", "version": "1.7.36", ... } ] }
```

### Example 3: add your own test case

Tests live in `svm-e2e/test/`. To check that a blocked removal keeps the add result (this already
exists in `orchestrator.test.ts`):

```ts
it('marks REMOVAL_BLOCKED on 401/403 and keeps the add result', async () => {
  const { deps, store, uploader } = setup();
  const run = await startRun(deps);
  store.transition(run.runId, 'ADD_VERIFIED', { addResult: 'PASS' });
  uploader.upload = async () => {
    throw new BlockedError(403);
  }; // simulate denied permission
  await tick(deps);
  expect(store.get(run.runId)).toMatchObject({
    state: 'REMOVAL_BLOCKED',
    removeResult: 'BLOCKED',
    addResult: 'PASS',
  });
});
```

The pattern for any new case: `setup()` → `startRun` → change the fake (`bd`, `uploader`) or move
the clock with `advance()` → `tick` → assert on `store.get(...)`.

## Before the first real run

1. Create the Black Duck project `svm-e2e-sync` and a service account with scan rights on it only.
2. Do the spikes: upload a two-component SBOM by hand, upload a second one without a component to
   the same code location, and confirm the component leaves the BOM. Note the exact API calls.
3. Fix the unverified pieces: `blackduck.sbom_upload_path` in `config/settings.yaml`, the Black
   Duck calls in `src/bd-client.ts`, and the SVM calls in `verify/svm-api.ts` and
   `verify/pages/svm-asset-page.ts`. Choose real components in `settings.yaml`.

## Run it for real

```bash
cd svm-e2e
npx playwright install chromium
export BD_URL=https://blackduck.your-company.internal  # your internal Black Duck (overrides the YAML)
export SVM_API_URL=...     # optional, overrides svm.api_url
export SVM_UI_URL=...      # optional, overrides svm.ui_url
export BD_API_TOKEN=...    # Black Duck, scan rights on the test project
export SVM_API_TOKEN=...   # SVM, read-only
export SLACK_WEBHOOK_URL=... # optional

npm run start-run   # start one run
npm run status      # see it: state and next check time
npm run tick:all    # run this every hour (pipelines/tick.yml does it for you)
```

`tick:all` does three things in order: `tick` (Black Duck steps), Playwright (SVM checks for due
runs), `notify` (Slack summary for finished runs). Run `npm run status` any time to see where
every run is. Reports land in `svm-e2e/results/junit.xml` and `svm-e2e/playwright-report/`.

## Troubleshooting

| You see                                              | Likely cause and fix                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Missing required environment variable BD_API_TOKEN` | Export the secrets before running                                                                                               |
| `Black Duck project "svm-e2e-sync" not found`        | Create the project first                                                                                                        |
| `no vulnerabilities for log4j-core@...`              | Black Duck lists none for that component; choose another in `settings.yaml`                                                     |
| Run ends `REMOVAL_BLOCKED`                           | The account was denied (401/403). The add result is kept. Ask the Black Duck admin about unmap rights, or use a cleanup service |
| `REMOVE_TIMEOUT`, component still in SVM             | Check whether SVM drops components or only marks them resolved; the remove assertion assumes it drops them                      |
| Run stuck in one state                               | `npm run cleanup` flags runs with no progress for 24 hours                                                                      |
| `ERROR` results                                      | Network, token or SVM trouble. They retry automatically and are not product failures                                            |
| Playwright says "No tests found"                     | Fine: no run is due this hour. `npm run verify` already passes in that case                                                     |

## Where to go next

- [`svm-e2e/README.md`](../svm-e2e/README.md): command table and what must be confirmed.
- [Architecture](../svm-e2e/docs/architecture.md), [configuration](../svm-e2e/docs/configuration.md)
  and [runbook](../svm-e2e/docs/runbook.md): the reference docs.
- `svm-e2e/src/orchestrator.ts`: the state machine.
- `svm-e2e/verify/phase.ts`: the SVM checks and how each outcome is recorded.
