import { test, expect } from '../../src';
import { ui5, Ui5Table } from '../../src';

// This app is a different live demo than the rest of this suite - the SAPUI5 SDK's own official
// `sap.m.Table` sample, used here specifically because (unlike the Shopping Cart demo the other
// examples target) it actually contains a real `sap.m.Table`, not just `sap.m.List`s. See
// docs/ui5-table.md.
const TABLE_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-id=sap.m.sample.Table&sap-ui-xx-sample-lib=sap.m&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com';

/**
 * Demonstrates `Ui5Table` - row access by index/content, cell text, and column headers for a
 * `sap.m.Table`. See docs/ui5-table.md.
 */
test.describe('Ui5Table', () => {
  test('row count, column headers, and cell text', async ({ page }) => {
    await page.goto(TABLE_SAMPLE_URL);

    const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));

    expect(await table.rowCount()).toBeGreaterThan(0);
    expect(await table.columnHeaders()).toEqual([
      'Product',
      'Supplier',
      'Dimensions',
      'Weight',
      'Price',
    ]);

    // Column 1 ("Supplier") of row 0 - see docs/ui5-table.md for the DOM convention this relies on.
    const supplier = await table.cellText(0, 1);
    expect(supplier.length).toBeGreaterThan(0);
  });

  test('rowContaining finds a row by its visible content', async ({ page }) => {
    await page.goto(TABLE_SAMPLE_URL);

    const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));

    const row = await table.rowContaining('Titanium');
    await expect(row).toBeVisible();
  });

  test('row() throws a clear error for an out-of-range index', async ({ page }) => {
    await page.goto(TABLE_SAMPLE_URL);

    const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));

    await expect(table.row(999999)).rejects.toThrow(/out of range/);
  });
});
