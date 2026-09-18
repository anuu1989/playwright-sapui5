# Accessibility testing

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

This framework doesn't reinvent accessibility testing - it works well alongside
[`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright),
the official Playwright integration for [axe-core](https://github.com/dequelabs/axe-core), the
same engine behind most browser accessibility linters. This page shows the pattern; see
[`examples/tests/accessibility.spec.ts`](../examples/tests/accessibility.spec.ts) for a complete,
real, passing example.

## Install

```bash
npm install --save-dev @axe-core/playwright
```

## Basic usage

```ts
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from 'playwright-sapui5';
import { CartPage } from '../pages/CartPage';

test('the page has no accessibility violations', async ({ page }) => {
  const cart = new CartPage(page);
  await cart.open(); // waits for the app to settle before scanning - see below

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toHaveLength(0);
});
```

`AxeBuilder` scans the page's current DOM and returns a list of `violations`, each with an
`impact` (`minor`/`moderate`/`serious`/`critical`), a human-readable `help` message, and the
specific `nodes` (with CSS selectors) that triggered it.

## Wait for the app to settle before scanning

Scan too early and you'll get incomplete, misleading results (or none at all) - a UI5 app that's
still rendering doesn't yet have the DOM axe needs to check. Always navigate via `Ui5Page.goto()`
(or call `waitForUi5(page)` yourself) before scanning, exactly as you would before interacting
with a locator. This framework's auto-wait (see [docs/auto-wait.md](auto-wait.md)) handles this
for you automatically when you use `Ui5Page.goto()`.

## Scoping a scan

Scan only part of the page with `.include()` (accepts a CSS selector) - useful for checking a
specific widget in isolation, or for excluding a known-noisy third-party region:

```ts
const results = await new AxeBuilder({ page })
  .include('[id="myApp---mainView--productTable"]')
  .analyze();
```

Combine this with the framework's own locators by resolving a `Ui5Locator` to find the right id
first if you don't already know it.

## Real apps have existing accessibility debt - the baseline pattern

Most real apps, including this repo's own example target (SAP's public Shopping Cart demo),
already have some accessibility issues by the time you start testing. Asserting zero violations
on day one either fails immediately (blocking unrelated work on pre-existing debt you may not be
able to fix right away) or gets the whole check disabled out of frustration. A more sustainable
pattern - what
[`examples/tests/accessibility.spec.ts`](../examples/tests/accessibility.spec.ts) actually does -
is to **baseline the current count and assert against regressions**, not perfection:

```ts
const results = await new AxeBuilder({ page }).analyze();

// Known, tracked debt - not this test's job to fix. Catches *new* issues without blocking on
// old ones. Lower this number as you fix violations; the goal is 0.
const KNOWN_BASELINE_VIOLATIONS = 4;
expect(results.violations.length).toBeLessThanOrEqual(KNOWN_BASELINE_VIOLATIONS);
```

As you fix violations on your own app, lower the number - and once it hits 0, switch to
`toHaveLength(0)` so any new issue fails the build immediately.

## Attaching results to the HTML report

Whether or not the test fails, attaching the full violation list makes it easy to inspect without
re-running anything:

```ts
test('...', async ({ page }, testInfo) => {
  // ...
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach('axe-violations', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  // ...
});
```

Open with `npx playwright show-report` after a run and look at the test's attachments.

## What this catches (and doesn't)

axe-core catches a large, well-established set of automatically detectable issues: missing ARIA
attributes, insufficient color contrast, missing form labels, invalid ARIA roles/parent-child
relationships, and more. It does **not** replace manual accessibility review (keyboard navigation
flow, screen reader announcements that are technically valid but confusing, focus order) - treat
it as a fast, automated first line of defense, not a complete accessibility test suite.
