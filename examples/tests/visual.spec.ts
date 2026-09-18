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
  test.skip(
    process.platform !== 'darwin',
    `Baseline snapshot was generated on macOS, not ${process.platform} - see docs/visual-testing.md before enabling in CI.`,
  );

  test('the category list matches its saved snapshot', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    const categoryList = await cart.categoryList.resolve();

    // A small tolerance absorbs minor anti-aliasing noise between runs on the same machine,
    // without hiding a genuine visual change.
    await expect(categoryList).toHaveScreenshot('category-list.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
