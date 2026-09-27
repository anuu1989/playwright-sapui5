import { test, expect } from '../../src';
import { ui5, Ui5SplitApp } from '../../src';

// The SAPUI5 SDK's own official sample for this control - see docs/split-app.md.
const SPLIT_APP_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com&sap-ui-xx-sample-id=sap.m.sample.SplitApp';

/**
 * Demonstrates `Ui5SplitApp` - the classic master/detail responsive shell. See docs/split-app.md,
 * and docs/flexible-column-layout.md for the newer three-column shell this predates.
 */
test.describe('Ui5SplitApp', () => {
  test('reads the mode and the current master/detail pages', async ({ page }) => {
    await page.goto(SPLIT_APP_SAMPLE_URL);

    const shell = ui5(page).controlType('sap.m.SplitApp');
    await shell.waitFor({ timeout: 15000 });

    expect(await Ui5SplitApp.mode(page, shell)).toBe('ShowHideMode');

    const pages = await Ui5SplitApp.currentPages(page, shell);
    expect(pages.master).toBeTruthy();
    expect(pages.detail).toBeTruthy();

    // The locator is optional - an app almost always has exactly one SplitApp, the same
    // convention Ui5FlexibleColumnLayout uses.
    expect(await Ui5SplitApp.mode(page)).toBe(await Ui5SplitApp.mode(page, shell));
  });
});
