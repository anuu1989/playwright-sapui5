import { test, expect } from '../../src';
import { ui5, Ui5Bridge, Ui5Table } from '../../src';

// The SAPUI5 SDK's "Browse Orders" demo app - the classic master-detail / list-detail navigation
// pattern (an `sap.m.SplitContainer`-based shell): a list of orders on one side, a detail view on
// the other, selecting a row updates the detail pane in place rather than navigating to a new
// page. See docs/demo-apps.md.
const ORDER_BROWSER_URL =
  'https://ui5.sap.com/test-resources/sap/m/demokit/orderbrowser/webapp/test/mockServer.html?sap-ui-theme=sap_horizon';

test.describe('Master-detail navigation (Browse Orders)', () => {
  test('selecting an order in the master list updates the detail pane', async ({ page }) => {
    await page.goto(ORDER_BROWSER_URL);

    // This app's mock data loads on a delay that this framework's fetch/XHR instrumentation and
    // busy-state tracking don't see (a `setTimeout`-based mock server, not a real network
    // request) - `waitForUi5()` alone can settle *before* the real rows exist, at which point
    // `Ui5Table.from()`'s auto-detection (docs/ui5-table.md) sees only the list's "no data"
    // placeholder and its growing-list "load more" trigger (itself rendered as a
    // `sap.m.CustomListItem`), and wrongly concludes that's the row type. Waiting for at least one
    // real row control to exist first, then telling `Ui5Table` the row type explicitly instead of
    // relying on auto-detection, sidesteps both problems - see
    // docs/troubleshooting.md#an-auto-detected-row-type-turns-out-to-be-wrong-immediately-after-navigation.
    const masterList = ui5(page).id('container-orderbrowser---master--list');
    await ui5(page).controlType('sap.m.ObjectListItem').waitFor({ timeout: 15000 });
    const list = await Ui5Table.from(masterList, { rowControlType: 'sap.m.ObjectListItem' });

    expect(await list.rowCount()).toBeGreaterThan(0);

    const firstOrderRow = await list.row(0);
    // Reading the row's own `title` property through the bridge (via its exact DOM id) rather
    // than scraping rendered text - the same "control property, not DOM text" approach
    // `toHaveUi5Property`/`toHaveUi5Text` use (docs/expect-matchers.md), just called directly here
    // since this value is needed as a plain string to build a second locator with, not asserted on.
    const rowId = await firstOrderRow.evaluate((el) => el.id);
    const orderTitle = (await Ui5Bridge.getControlText(page, rowId)).value ?? '';

    await firstOrderRow.click();

    // The detail pane's own header repeats the selected order's title - a real, live-updating
    // master-detail split, not a full page navigation (the master list is still visible,
    // untouched, right alongside it).
    await expect(
      await ui5(page).text(orderTitle, { controlType: 'sap.m.Title' }).resolve(),
    ).toBeVisible();

    // The detail pane's own "Line Items" table - an ordinary sap.m.Table, wrapped with Ui5Table
    // exactly like any other. Demonstrates nesting: a table inside a detail view that itself only
    // exists because of a master-list selection.
    const lineItemsTable = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));
    expect(await lineItemsTable.rowCount()).toBeGreaterThan(0);
  });
});
