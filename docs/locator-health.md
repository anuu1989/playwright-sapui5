# Locator health (aggregating self-heals across a run)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Self-healing ([docs/locators.md](locators.md#self-healing-fallback-strategies)) already makes a
broken primary locator visible - it logs a console warning the moment it happens. `HealthReporter`
turns that into something stronger: a **run-level trend**, so "this locator healed once" (a
warning) and "this locator heals on every single run" (a locator that's already wrong, and only
passing because its fallback is doing the real work) don't look the same.

```ts
// playwright.config.ts
reporter: [['list'], ['playwright-sapui5/reporter/health']],
```

That's the whole setup - no change to existing tests or locators required. Run your suite as
usual, and if anything healed, you'll see:

```
[playwright-sapui5] 1 self-heal(s) across 1 locator(s) - the primary strategy needs attention:
  1x  Laptops category (deliberately broken primary strategy)  (1 test(s))
        healed via {"by":"text","text":"Laptops","controlType":"sap.m.StandardListItem"}  (1x)
```

Nothing is printed when nothing healed.

## Why a reporter, and not just `onHeal()`

`SelfHealingResolver.onHeal(listener)` already exists and works well for logging a heal the moment
it happens. But a **reporter** runs in Playwright's main process, which is a _different_ process
from the one a worker actually runs tests in whenever more than one worker is used - the default.
Subscribing to `onHeal()` from inside a reporter would silently hear nothing, because the event
fires in a process the reporter isn't in.

The fix is the same pattern [`JiraReporter`](jira.md) already uses for the UI5 control-tree
diagnostics attachment: a fixture subscribes _inside_ the worker (where the heal actually happens),
collects everything that healed during that one test, and attaches it to the test result as
`ui5-heals.json`. That attachment crosses the process boundary as ordinary Playwright test-result
data - which any reporter can read in `onTestEnd`, regardless of which worker produced it. This
fixture (`ui5HealthTracking`) is built into this package's `test` and needs no opt-in, the same way
the control-tree diagnostics attachment doesn't.

One deliberate choice: the attachment is added on a **passing** test too, not just a failure. A
heal means the primary strategy didn't match - that's worth tracking whether or not it happened to
also be the difference between pass and fail this particular run.

## Options

| Option       | Default | What it does                                                                                                                                |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `outputFile` | -       | Write the full aggregation to this path as JSON, e.g. to diff against a previous run and catch a locator that started healing only recently |
| `failOnHeal` | `false` | Fail the run if anything healed at all                                                                                                      |

```ts
reporter: [
  ['list'],
  [
    'playwright-sapui5/reporter/health',
    { outputFile: 'locator-health.json', failOnHeal: true },
  ],
],
```

`failOnHeal` only escalates a run that would otherwise report as `'passed'` - a run that already
failed for its own reasons keeps that more specific status rather than being overwritten with a
less informative one. Off by default: a heal is a warning about drift in your test suite, not a
defect in the app under test, so failing a build over it without being asked would be a surprising
thing for a reporter to do.

The JSON `outputFile` writes is an array of rows, each shaped like:

```json
{
  "label": "Laptops category (deliberately broken primary strategy)",
  "count": 1,
  "tests": ["self-healing.spec.ts › Self-healing locators › ..."],
  "strategies": {
    "{\"by\":\"text\",\"text\":\"Laptops\",\"controlType\":\"sap.m.StandardListItem\"}": 1
  }
}
```

## What's actually verified

The aggregation logic itself (grouping by label, counting distinct fallback strategies separately,
sort order, an unlabeled locator not silently dropping) is pure and covered directly in
[`examples/tests/health.spec.ts`](../examples/tests/health.spec.ts) - no browser or reporter
machinery needed to exercise those edge cases, the same way
[`examples/tests/jira.spec.ts`](../examples/tests/jira.spec.ts) tests Jira issue-key extraction
without a real Jira.

The reporter plumbing around that logic - reading the `ui5-heals.json` attachment, printing the
summary, writing `outputFile`, and `failOnHeal` actually changing the run's outcome - was verified
against real `npx playwright test` runs of
[`examples/tests/self-healing.spec.ts`](../examples/tests/self-healing.spec.ts) (which contains a
genuine, deliberately-broken locator that heals every run). That verification caught a real bug
before it shipped: setting `process.exitCode` directly from a reporter's `onEnd` does **not**
change the process's actual exit code - Playwright computes that from the run's final status
itself, after every reporter's `onEnd` has returned, which overrides whatever a reporter set along
the way. The fix, confirmed against a real run, is `onEnd` returning `{ status: 'failed' }`, which
is what `failOnHeal` does.

## Related

- [docs/locators.md](locators.md#self-healing-fallback-strategies) - `.fallback()` and `onHeal()`
  themselves
- [docs/diagnostics.md](diagnostics.md) - the control-tree attachment this reporter's plumbing
  pattern is borrowed from
- [docs/jira.md](jira.md) - another reporter built the same way, for a different purpose
- [docs/doctor.md](doctor.md) - a different kind of CI gate: not "are the tests' locators
  drifting", but "does the app itself work at all"
