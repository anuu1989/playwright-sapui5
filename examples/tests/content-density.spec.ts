import { test, expect } from '../../src';
import { ui5, Ui5ContentDensity } from '../../src';
import { CartPage } from '../pages/CartPage';

// The SDK's own documentation shell (not a demo app) - used here specifically because, unlike
// this repo's other three demo apps (all `null` - no explicit density class, SAPUI5's cozy
// default), it boots with `sapUiSizeCompact` already applied, giving a real second observed
// starting state alongside the others. See docs/content-density.md.
const TABLE_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-id=sap.m.sample.Table&sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com';

/**
 * Demonstrates `Ui5ContentDensity` - reading and forcing SAPUI5's compact/cozy content density,
 * and confirming it actually changes how a real control renders. See docs/content-density.md.
 */
test.describe('Ui5ContentDensity', () => {
  test('get/set/toggle against a real app, with a genuine measured row-height difference', async ({
    page,
  }) => {
    await page.goto(TABLE_SAMPLE_URL);
    await ui5(page).controlType('sap.m.ColumnListItem').waitFor({ timeout: 15000 });

    // This app's own shell already boots compact - a real, observed non-null starting state.
    expect(await Ui5ContentDensity.get(page)).toBe('compact');

    const rowHeight = async () =>
      page.evaluate(
        () => document.querySelector('.sapMListTblRow')?.getBoundingClientRect().height,
      );

    await Ui5ContentDensity.set(page, 'cozy');
    expect(await Ui5ContentDensity.get(page)).toBe('cozy');
    const cozyHeight = await rowHeight();

    await Ui5ContentDensity.set(page, 'compact');
    expect(await Ui5ContentDensity.get(page)).toBe('compact');
    const compactHeight = await rowHeight();

    // Not just "the class changed" - the control actually renders differently because of it.
    expect(compactHeight).toBeLessThan(cozyHeight!);

    // toggle() flips to the other density and reports which one is now active.
    expect(await Ui5ContentDensity.toggle(page)).toBe('cozy');
    expect(await Ui5ContentDensity.get(page)).toBe('cozy');
  });

  test('get() returns null on a real app that sets no explicit density class', async ({ page }) => {
    // The Shopping Cart demo (this repo's default baseURL) boots with neither class present -
    // SAPUI5's own cozy default, with nothing to detect rather than a failure to detect it.
    await new CartPage(page).open();
    expect(await Ui5ContentDensity.get(page)).toBeNull();
  });
});
