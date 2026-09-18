# Visual regression testing

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Playwright has built-in screenshot comparison (`expect(locator).toHaveScreenshot()`) - no extra
package needed. This page covers the parts that matter specifically for a SAPUI5 app, and the one
constraint that catches people out with visual testing generally. See
[`examples/tests/visual.spec.ts`](../examples/tests/visual.spec.ts) for a complete, real example
(read the note at the top of that file before you run it - see [Platform
sensitivity](#platform-sensitivity) below).

## Basic usage

```ts
import { test, expect } from 'playwright-sapui5';
import { CartPage } from '../pages/CartPage';

test('the category list matches its saved snapshot', async ({ page }) => {
  const cart = new CartPage(page);
  await cart.open();

  const categoryList = await cart.categoryList.resolve();
  await expect(categoryList).toHaveScreenshot('category-list.png');
});
```

The first run writes a baseline image (with `--update-snapshots`, see below); every run after
that compares against it and fails if the rendered element differs by more than the configured
tolerance.

```bash
npx playwright test --update-snapshots   # (re)generate baselines
npx playwright test                       # compare against them
```

## Prefer a scoped element over a full-page screenshot

`expect(locator).toHaveScreenshot()` (an element) is almost always a better choice than
`expect(page).toHaveScreenshot()` (the whole viewport) for a SAPUI5 app specifically:

- **Less flaky.** A full page includes far more surface area for something unrelated to change -
  a rotating promotional carousel, a clock, an ad. This repo's own example demo app rotates its
  "Promoted Items" between sessions (different products, different images, every load) - a
  full-page screenshot of it would never match twice. The category list, by contrast, is static
  data and renders identically every time - that's specifically why the example test targets it.
- **Faster to review.** A focused diff on one widget is easy to eyeball; a full-page diff with one
  small change somewhere is not.

If you do need a full-page comparison, mask out anything dynamic first:

```ts
await expect(page).toHaveScreenshot('home.png', {
  mask: [page.locator('[data-testid="clock"]'), ui5(page).controlType('sap.m.Carousel').css('...')],
});
```

## Wait for the app to settle first

Same rule as everywhere else in this framework: screenshot before the app has finished rendering
and you'll get a flaky, half-loaded capture. `Ui5Page.goto()` already waits for the app to settle
(see [docs/auto-wait.md](auto-wait.md)) - if you're taking a screenshot mid-test after some other
interaction, call `await cart.waitForUi5Ready()` (or `waitForUi5(page)`) immediately before it.

## Tolerance

`maxDiffPixelRatio` (0 to 1) allows a small fraction of pixels to differ before failing - useful
for absorbing font anti-aliasing noise between runs on the _same_ machine, without hiding a
genuine visual regression:

```ts
await expect(categoryList).toHaveScreenshot('category-list.png', { maxDiffPixelRatio: 0.02 });
```

Playwright also supports `maxDiffPixels` (an absolute count) and `threshold` (per-pixel color
sensitivity) - see [Playwright's own
docs](https://playwright.dev/docs/test-snapshots) for the full set of options.

## <a id="platform-sensitivity"></a>Platform sensitivity - the one thing that catches people out

Screenshots are pixel comparisons, and font/anti-aliasing rendering genuinely differs between
operating systems (macOS, Linux, Windows) and even browser engine builds. **A baseline generated
on your Mac will not reliably match a comparison run in Linux-based CI.** Playwright names
snapshot files to include the platform for exactly this reason -
`category-list-chromium-darwin.png` on macOS, `category-list-chromium-linux.png` on Linux - so a
mismatch produces a clear "missing snapshot" error rather than a confusing pixel diff.

**This repo's own example demonstrates the problem directly**: its committed baseline
(`examples/tests/visual.spec.ts-snapshots/category-list-chromium-darwin.png`) was generated on
macOS, so [`examples/tests/visual.spec.ts`](../examples/tests/visual.spec.ts) checks
`process.platform` and skips itself on anything other than macOS - including this repo's own CI
(which runs on Ubuntu) - instead of failing for every contributor or CI runner on a different
platform. If you want visual tests in your own CI:

- Generate baselines **in the same environment CI will compare against** - typically, run
  `npx playwright test --update-snapshots` inside the same Docker image (or a matching GitHub
  Actions runner) your CI pipeline uses, and commit whatever that produces.
- The official `mcr.microsoft.com/playwright` Docker images (versioned to match your
  `@playwright/test` version) are the standard way to get a reproducible rendering environment for
  this - see [Playwright's Docker
  docs](https://playwright.dev/docs/docker).
