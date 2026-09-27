# Generating a test suite from a URL

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

```bash
npx pw-sapui5 generate-tests --url https://your-app.example.com/ --output tests/app.spec.ts
npx playwright test tests/app.spec.ts
```

Point it at a running SAPUI5 app and it writes a **runnable** Playwright suite for that specific
app. It loads the app for real, works out what it is, and emits tests derived from what it
actually saw.

This is the sibling of [`pw-sapui5 generate`](generator.md), which writes a Page Object describing
an app's _controls_. This one writes _tests_.

## What it prints

```
Launching browser and analysing https://.../cart/webapp/index.html ...
  App:      Shopping Cart
  Controls: 217 rendered
  Routes:   5 navigable, 5 need parameters
  Detected: flexibleColumnLayout, list, searchField
  Startup:  ~2519ms to settle
```

The analysis is the interesting part - it's what decides which tests get written.

## What it generates

| Detected                                            | Test emitted                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| always                                              | **Smoke** - controls rendered, and no errors in SAPUI5's message model |
| always                                              | **Performance budget** - scaled from the startup it just measured      |
| routes with no required parameters                  | one **navigation** test each, via the app's own router                 |
| `sap.f.FlexibleColumnLayout`                        | column-layout assertions                                               |
| SmartFilterBar + SmartTable                         | **search the list report**, then read the true row count               |
| SmartVariantManagement                              | variants are present and one is active                                 |
| `sap.m.Table` / `sap.ui.table.Table` / `sap.m.List` | row/header assertions with the right helper                            |

Plus a TODO block listing what a machine _shouldn't_ decide - see below.

## The two rules it follows

### 1. It never clicks anything

The generator cannot tell `"Show Details"` from `"Delete Order"`, and it may well be pointed at a
real system. So it navigates by route, reads, and asserts - nothing else. Interactions worth
adding are emitted as commented-out TODOs, with the reason attached:

```ts
// Routes needing parameters the generator had no way to invent:
//   await Ui5Navigation.navTo(page, 'category', { id: '...' });  // pattern: category/{id}
//
// A search field was found - filling it is safe, asserting the result is yours:
//   await ui5(page).controlType('sap.m.SearchField').fill('something');
```

### 2. It only emits tests that should pass

A generated suite that fails on its first run is worse than no suite - it teaches people to ignore
red. So every assertion is anchored to something observed:

- The **performance ceiling** is ~3x the startup it just measured (floored at 15s), not a
  number picked out of the air.
- **Row assertions** depend on what was on screen. A table with rows gets `toBeGreaterThan(0)`;
  a Fiori Elements list report - legitimately empty until someone searches - gets
  `toBeGreaterThanOrEqual(0)` and a comment saying why.
- When a **SmartFilterBar** drives a table, no standalone table test is emitted at all: the search
  test already covers it, and a second one would assert against an empty table.
- Every test navigates through a `beforeEach` that waits for the UI5 core **and** for the app to
  settle. `page.goto()` returns long before a SAPUI5 app has booted; skipping that wait is the
  single most common way a generated suite fails immediately.

These rules were not theoretical. The first version of this generator produced 11 failing tests
across three demo apps, for exactly these reasons - missing waits, and a `> 0` row assertion
against a list report that starts empty.

## Verified against real apps

The generator is exercised against three structurally different live apps, and **the generated
output is run as part of this repo's own suite** - see
[`examples/tests/generated/`](../examples/tests/generated/):

| App             | What it is                            | Generated |
| --------------- | ------------------------------------- | --------- |
| Shopping Cart   | `sap.m` app on a FlexibleColumnLayout | 9 tests   |
| Browse Orders   | master-detail                         | 5 tests   |
| Manage Products | Fiori Elements list report            | 4 tests   |

18 generated tests, all passing. If a change to the generator starts emitting something that
doesn't work, this repo's own CI catches it.

## Options

| Flag            | Default               |                                        |
| --------------- | --------------------- | -------------------------------------- |
| `--url`         | _(required)_          | the app to analyse                     |
| `--output`      | `./generated.spec.ts` | where to write                         |
| `--title`       | the app's own title   | the `test.describe` name               |
| `--import-from` | `playwright-sapui5`   | module the generated file imports from |
| `--headed`      | `false`               | watch the analysis run                 |
| `--timeout`     | `30000`               | navigation/ready timeout               |

## What it is and isn't

It's a **starting point** that gets a new app from zero to a green, meaningful baseline in one
command - covering navigation, presence and shape, which is the tedious part. It is not a
replacement for tests of what your app is actually _for_. The business flows - fill this, submit
that, check the order total - still need a human, and the TODO block at the bottom of every
generated file says so.

## Related

- [docs/generator.md](generator.md) - the Page Object generator
- [docs/navigation.md](navigation.md) - the routing helpers the generated navigation tests use
- [docs/performance.md](performance.md) - what the generated budget test measures
