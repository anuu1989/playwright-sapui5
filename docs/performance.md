# Ui5Performance (how long the app really takes)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5Performance` measures how long a SAPUI5 app takes to become _usable_, which is not what the
browser's load timings tell you. See
[`examples/tests/performance-and-navigation.spec.ts`](../examples/tests/performance-and-navigation.spec.ts)
for a complete, real, passing example.

## Why the browser's numbers mislead you

UI5 bootstraps **after** the page `load` event. Only then does it pull in dozens of library
modules, instantiate a component, load views, and resolve an OData model's metadata - all before a
single control renders. So a page can report a fast load and still be blank.

Real numbers from the example test, against SAP's own Shopping Cart demo:

| Measurement                           | Value        |
| ------------------------------------- | ------------ |
| `loadEventMs` (browser says "loaded") | **337 ms**   |
| `coreReadyMs` (UI5 runtime up)        | 1,491 ms     |
| `settledMs` (app actually usable)     | **2,644 ms** |

An 8x difference. Anyone tracking `loadEvent` as their startup metric is measuring something close
to nothing.

## Measuring a startup

```ts
const timings = await Ui5Performance.measureBootstrap(page, APP_URL);

expect(timings.settledMs).toBeLessThan(15000);
```

Navigates and times three milestones, all in milliseconds from the start of navigation:

- `navigationMs` - `page.goto()` returned
- `coreReadyMs` - the SAPUI5 runtime has bootstrapped (`sap.ui.getCore()` exists)
- `settledMs` - no busy indicator, no in-flight requests, control tree stable: the app is done

Those last two are the same waits every test in this framework already performs
([docs/auto-wait.md](auto-wait.md)) - this just puts a stopwatch on them, so a startup regression
shows up as a number instead of as "the suite feels slower lately".

## Metrics for a loaded page

```ts
const metrics = await Ui5Performance.metrics(page);
// { responseEndMs, domContentLoadedMs, loadEventMs,
//   resourceCount, ui5ResourceCount, controlCount }
```

`controlCount` is the one most worth watching over time. A view that quietly starts rendering
thousands of controls is a classic cause of a Fiori app turning sluggish, and it shows up here
long before anyone files a performance bug.

## Writing a useful assertion

Don't turn this into a benchmark that fails on a slow laptop. Two patterns that hold up:

```ts
// A generous ceiling - catches "pathologically broken", ignores normal variance
expect(timings.settledMs).toBeLessThan(30000);

// A relationship, not an absolute - always true, machine-independent
expect(timings.settledMs).toBeGreaterThan(timings.metrics.loadEventMs ?? 0);
```

For tracking real regressions, record the numbers somewhere over time rather than asserting tight
bounds in the test itself - a CI run's absolute timings say more about the runner than the app.
