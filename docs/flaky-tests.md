# Flaky test detection (`FlakyTestReporter`)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

A different question from [locator health](locator-health.md): not "which locators are healing",
but "which **tests** aren't reliably passing." `FlakyTestReporter` aggregates Playwright's own
per-run retry data into a clear report, and - given a `historyFile` - tracks it across runs so a
test that's inconsistent over time shows up even on a run where nothing failed.

```ts
// playwright.config.ts
reporter: [
  ['list'],
  [
    'playwright-sapui5/reporter/flaky-tests',
    { historyFile: '.pw-sapui5/flaky-history.json' },
  ],
],
```

## What "flaky" means here

Playwright already computes this: `TestCase.outcome()` returns `'flaky'` for a test that failed at
least once but ultimately passed after a retry - which only ever happens if `retries` is
configured above `0`. Without `historyFile`, this reporter reports exactly that, once per run:

```
[playwright-sapui5] 1 test(s) needed a retry to pass this run:
  flaky.spec.ts › fails only on the very first attempt ever, across runs  (2 attempts)
```

Nothing is printed when nothing needed a retry.

## Cross-run history and quarantine candidates

A test can be genuinely unreliable without ever triggering Playwright's own single-run `'flaky'`
outcome - e.g. with `retries: 0`, or a test that happens to fail cleanly in one run and pass
cleanly in the next, never needing a retry within either individual run. `historyFile` tracks the
outcome of every run and flags a test whose share of **troubled** runs (anything short of a clean
pass - `'flaky'` or an outright failure) crosses a threshold:

```
[playwright-sapui5] 1 quarantine candidate(s) - not reliably passing across tracked runs:
  flaky.spec.ts › fails only on the very first attempt ever, across runs  (1/3 troubled runs, 33%)
```

"Quarantine candidate" is a report, not an action - this reporter has no mechanism to skip a test
itself. What you do with the list (investigate, `test.skip()` it, exclude it from a required CI
gate) is up to you.

## Options

| Option                      | Default | What it does                                                                              |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `historyFile`               | -       | Persist pass/flaky/fail history across runs here, and compute flakiness over time from it |
| `historyLimit`              | `20`    | How many of the most recent runs to retain per test                                       |
| `quarantineThreshold`       | `0.2`   | A test at or above this share of troubled tracked runs is a quarantine candidate          |
| `minRunsForQuarantine`      | `3`     | Minimum tracked runs before a test can be flagged - avoids flagging off a single bad run  |
| `outputFile`                | -       | Write the full report (this run's flaky tests, plus quarantine candidates) here as JSON   |
| `failOnQuarantineCandidate` | `false` | Fail the run if any quarantine candidate was found                                        |

`failOnQuarantineCandidate` only escalates a run that would otherwise report as `'passed'` - the
same rule [`HealthReporter`'s `failOnHeal`](locator-health.md) follows, for the same reason.

## What's actually verified

**The aggregation logic is pure** and covered directly in
[`examples/tests/flaky-tests.spec.ts`](../examples/tests/flaky-tests.spec.ts) - `historyLimit`
capping (the oldest run ages out, not the newest), a test absent from the current run keeping its
prior history untouched, and `findQuarantineCandidates` requiring _both_ the threshold and the
minimum run count (a test at 50% troubled over only 2 runs is correctly not flagged; one at
exactly the 20% threshold over 5 runs is).

**The reporter plumbing** - `TestCase.outcome()` actually reflecting the final attempt, reading
and writing `historyFile` across real separate process invocations, and
`failOnQuarantineCandidate` actually changing the run's exit code - was verified against three
consecutive real `npx playwright test` runs of a deliberately flaky test (fails on its very first
attempt ever, passes every attempt after): run 1 reported `'flaky'` and wrote history; run 2 passed
cleanly and correctly reported no quarantine candidate yet (2 tracked runs, below the default
minimum of 3); run 3 - itself a clean pass, no failure of its own - correctly reported a
quarantine candidate (1/3 troubled runs) and **exited the process with code 1**, confirming
`failOnQuarantineCandidate` genuinely overrides an otherwise-green run's exit code, the same
`{ status: 'failed' }`-not-`process.exitCode` mechanism [`HealthReporter`](locator-health.md)'s own
verification first established.

## Related

- [docs/locator-health.md](locator-health.md) - the same reporter pattern, for self-healing
  locators instead of inconsistent tests
- [docs/jira.md](jira.md) - another reporter built the same way, for a different purpose
