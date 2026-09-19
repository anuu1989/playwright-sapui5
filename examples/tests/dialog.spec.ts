import { test, expect } from '../../src';
import { Ui5Dialog } from '../../src';

// Same UI5 SDK, a different sample: this one specifically demonstrates `sap.m.ViewSettingsDialog`
// - a standard SAPUI5 pattern for sort/filter/group UI - triggered from toolbar buttons. See
// docs/ui5-dialog.md.
const DIALOG_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-id=sap.m.sample.TableViewSettingsDialog&sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com';

/**
 * Demonstrates `Ui5Dialog` - waiting for a dialog to open, finding its buttons by text without
 * ambiguity, and waiting for it to close. See docs/ui5-dialog.md.
 */
test.describe('Ui5Dialog', () => {
  test('open, read its buttons, and close it', async ({ page }) => {
    await page.goto(DIALOG_SAMPLE_URL);

    // The "Sort" toolbar button - a plain UI5-aware click like any other action in this
    // framework. `Ui5Dialog` only takes over once something has already been triggered to open.
    await page.getByRole('button', { name: 'Sort' }).click();

    const dialog = await Ui5Dialog.open(page);

    await expect(await dialog.button('OK')).toBeVisible();
    await expect(await dialog.button('Cancel')).toBeVisible();

    await dialog.clickButton('Cancel');
    await dialog.waitForClose();
  });

  test('Ui5Dialog.open() fails clearly when nothing is open', async ({ page }) => {
    await page.goto(DIALOG_SAMPLE_URL);

    await expect(Ui5Dialog.open(page, { timeout: 1000 })).rejects.toThrow(
      /No open dialog\/popover found/,
    );
  });
});
