import { test, expect } from '../../src';
import { ui5, Ui5Table } from '../../src';

// The SAPUI5 SDK's "Shop Administration Tool" demo app - built on `sap.tnt.ToolPage`, a
// different app shell layout (side navigation + tool header) than any other example in this
// repo, which otherwise all use plain `sap.m.App`/`sap.m.SplitApp` shells. Demonstrates side
// navigation (including an expandable group) driving content changes, and a dashboard table,
// using nothing beyond this framework's existing general-purpose primitives. See
// docs/demo-apps.md.
const TOOL_PAGE_URL =
  'https://ui5.sap.com/test-resources/sap/tnt/demokit/toolpageapp/webapp/index.html?sap-ui-theme=sap_horizon';

test.describe('sap.tnt.ToolPage shell (Shop Administration Tool)', () => {
  test('a dashboard table, and side navigation swapping the content area', async ({ page }) => {
    await page.goto(TOOL_PAGE_URL);

    // The dashboard's "Customer Overview" table - an ordinary sap.m.Table, no different to wrap
    // than any other, regardless of which app shell it happens to live inside.
    const customerTable = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));
    expect(await customerTable.rowCount()).toBeGreaterThan(0);
    expect(await customerTable.columnHeaders()).toEqual(
      expect.arrayContaining(['Customer Name', 'Product ID', 'Payment']),
    );

    // Side navigation items are `sap.tnt.NavigationListItem` - clicking one swaps the ToolPage's
    // content area, the same "click something, content changes" pattern as any other navigation
    // in this framework, just inside a different shell control.
    await ui5(page).text('Settings', { controlType: 'sap.tnt.NavigationListItem' }).click();
    await expect(
      await ui5(page).text('Shop Owner Details', { controlType: 'sap.m.Title' }).resolve(),
    ).toBeVisible();

    // "Statistics" is an expandable navigation group (it has its own sub-items, "Usage
    // Statistics"/"Order Statistics") rather than a page of its own - clicking it just
    // expands/collapses, the sub-item underneath is the one that actually navigates.
    await ui5(page).text('Statistics', { controlType: 'sap.tnt.NavigationListItem' }).click();
    await ui5(page).text('Usage Statistics', { controlType: 'sap.tnt.NavigationListItem' }).click();
    await expect(
      await ui5(page).text('Usage Statistics', { controlType: 'sap.m.Title' }).resolve(),
    ).toBeVisible();
  });
});
