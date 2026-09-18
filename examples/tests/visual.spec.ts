import { test, expect } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates visual regression testing - see docs/visual-testing.md.
 *
 * Screenshot baselines are sensitive to the OS/browser-rendering engine that generated them (font
 * anti-aliasing differs between macOS, Linux, and Windows). The committed baseline here was
 * generated on macOS, so this skips itself on any other platform - including this repo's own CI
 * (which runs on Ubuntu) - rather than shipping a check that would fail for every contributor or
 * CI runner on a different platform. See docs/visual-testing.md#platform-sensitivity before
 * enabling this in your own CI.
 */
test.describe('Visual regression', () => {
  // `test.skip(condition, reason)`, called at the top level of a `describe` block (not inside a
  // `test(...)` callback), conditionally skips every test in that block - evaluated once, when
  // this file is first loaded, not per-test. `process.platform` is a plain Node.js global
  // ('darwin' for macOS, 'linux', 'win32', ...) - nothing Playwright-specific about it.
  test.skip(
    process.platform !== 'darwin',
    `Baseline snapshot was generated on macOS, not ${process.platform} - see docs/visual-testing.md before enabling in CI.`,
  );

  test('the category list matches its saved snapshot', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    const categoryList = await cart.categoryList.resolve();

    // `expect(locator).toHaveScreenshot('name.png', options)` is Playwright's own built-in
    // visual comparison assertion - no extra package needed (unlike `examples/tests/accessibility.spec.ts`'s
    // `@axe-core/playwright`). The first time this ever runs (with `--update-snapshots`), it
    // *creates* `category-list-chromium-darwin.png` next to this file; every run after that
    // compares the live element against that saved image instead.
    //
    // A small tolerance absorbs minor anti-aliasing noise between runs on the same machine,
    // without hiding a genuine visual change.
    await expect(categoryList).toHaveScreenshot('category-list.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
