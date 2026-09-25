import { test, expect } from '../../src';
import { ui5, Ui5ValueHelpDialog } from '../../src';

// Two different official SAPUI5 SDK samples, deliberately - value help dialogs come in two
// genuinely different shapes this framework needs to handle: a plain sap.m.Input opens a plain
// sap.m.SelectDialog (a sap.m.Table/List result list), while a SmartField-generated one commonly
// opens a full sap.ui.comp.valuehelpdialog.ValueHelpDialog (a sap.ui.table.Table result list
// instead). See docs/value-help-dialog.md.
const PLAIN_INPUT_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-id=sap.m.sample.InputAssisted&sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com';
const SMART_FIELD_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-id=sap.ui.comp.sample.smartfield.SmartFieldWithValueHelp&sap-ui-xx-sample-lib=sap.ui.comp&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com';

/**
 * Demonstrates `Ui5ValueHelpDialog` - opening a value help ("F4 help") dialog via its
 * undocumented `-vhi` trigger icon convention, and selecting a result row regardless of whether
 * the dialog's result list turns out to be a `sap.m.Table`/`List` or a `sap.ui.table.Table`. See
 * docs/value-help-dialog.md.
 */
test.describe('Ui5ValueHelpDialog', () => {
  test('plain sap.m.Input: SelectDialog with a sap.m.List result list', async ({ page }) => {
    await page.goto(PLAIN_INPUT_SAMPLE_URL);

    const field = ui5(page).id('productInput');
    const dialog = await Ui5ValueHelpDialog.openFor(field);

    await dialog.selectRow('Notebook Basic 15');

    await expect(field).toHaveUi5Property('value', 'Notebook Basic 15');
  });

  test('SmartField: ValueHelpDialog with a sap.ui.table.Table result list', async ({ page }) => {
    await page.goto(SMART_FIELD_SAMPLE_URL);

    const field = ui5(page).id('idDeliveryTransport');
    const dialog = await Ui5ValueHelpDialog.openFor(field);

    expect(await dialog.title()).toBe('Transport Delivery');

    await dialog.selectRow('Bicycle');

    await expect(field).toHaveUi5Property('value', '2 (Bicycle)');
  });

  test('openFor() fails clearly when the field has no value-help icon', async ({ page }) => {
    await page.goto(PLAIN_INPUT_SAMPLE_URL);

    const label = ui5(page).controlType('sap.m.Label');
    await expect(Ui5ValueHelpDialog.openFor(label, { timeout: 1000 })).rejects.toThrow(
      /has no value-help icon/,
    );
  });
});
