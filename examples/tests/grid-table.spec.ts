import { test, expect } from '../../src';
import { ui5, Ui5GridTable } from '../../src';

// The UI5 SDK's own "Basic" sample for sap.ui.table.Table - a real grid table with 123 rows of
// product data, only 10 of which render at once. See docs/ui5-grid-table.md.
const GRID_TABLE_SAMPLE_URL =
  'https://ui5.sap.com/resources/sap/ui/documentation/sdk/index.html?sap-ui-xx-sample-id=sap.ui.table.sample.Basic&sap-ui-xx-sample-lib=sap.ui.table&sap-ui-xx-sample-origin=.&sap-ui-xx-dk-origin=https://ui5.sap.com';

/**
 * Demonstrates `Ui5GridTable` - `sap.ui.table.Table`'s own dedicated helper, distinct from
 * `Ui5Table` (which only covers `sap.m.Table`/`sap.m.List`). See docs/ui5-grid-table.md.
 */
test.describe('Ui5GridTable', () => {
  test('true row count, column headers, and reading an already-rendered row', async ({ page }) => {
    await page.goto(GRID_TABLE_SAMPLE_URL);

    // `sap.ui.table.Table` builds its virtualized row pool slightly after its own root element
    // first renders - `.waitFor()` here waits for the app to settle (this framework's normal
    // auto-wait) before `Ui5GridTable.from()` reads that pool, so it doesn't race a table whose
    // rows haven't been created yet. See docs/ui5-grid-table.md#a-timing-gotcha-worth-knowing.
    const tableLocator = ui5(page).controlType('sap.ui.table.Table');
    await tableLocator.waitFor();
    const table = await Ui5GridTable.from(tableLocator);

    // The true count from the data binding - not the 10 or so rows actually in the DOM.
    expect(await table.rowCount()).toBe(123);
    expect(await table.columnHeaders()).toEqual(
      expect.arrayContaining(['Product Name', 'Product Id', 'Quantity']),
    );

    // Row 0 is part of the table's default rendered window, so no scrolling is needed for it.
    expect(await table.cellText(0, 0)).toBe('Notebook Basic 15');
  });

  test('row() past the rendered window throws a clear error, and scrollToRow() fixes it', async ({
    page,
  }) => {
    await page.goto(GRID_TABLE_SAMPLE_URL);

    const tableLocator = ui5(page).controlType('sap.ui.table.Table');
    await tableLocator.waitFor();
    const table = await Ui5GridTable.from(tableLocator);

    // Row 50 doesn't exist in the DOM at all yet - only ~10 rows are ever rendered at once.
    await expect(table.row(50)).rejects.toThrow(/is not currently rendered/);

    await table.scrollToRow(50);
    const row = await table.row(50);
    await expect(row).toBeVisible();
  });
});
