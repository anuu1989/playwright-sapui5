import { test, expect } from '../../src';
import { ui5, Ui5Locator, Ui5MdcTable, findUi5Frame, waitForUi5, waitForUi5Core } from '../../src';
import type { Frame } from '@playwright/test';

// SAP's own "Flexible Programming Model Explorer" from the SAPUI5 SDK - a real, live sap.fe
// (Fiori Elements for OData V4) app, not an isolated single-control sample. Its List Report Page
// topic renders the exact control set a real sap.fe app does: sap.fe.macros.FilterBar wrapping
// sap.ui.mdc.FilterBar, and sap.ui.mdc.Table - a different control family entirely from OData
// V2's sap.ui.comp.smartfilterbar/smarttable (see docs/smart-controls.md). The sample content
// itself renders inside an iframe, so this also exercises this framework's existing cross-frame
// support (findUi5Frame) rather than needing anything new for that part. See docs/mdc-table.md.
const FPM_EXPLORER_URL = 'https://ui5.sap.com/test-resources/sap/fe/core/fpmExplorer/index.html';

test('Ui5MdcTable reads a real sap.fe list report, and filtering it via the real UI changes the count', async ({
  page,
}) => {
  await page.goto(FPM_EXPLORER_URL);
  await waitForUi5Core(page, { timeout: 40000 }).catch(() => {
    /* the explorer shell itself has settled by the time the tree below is interactive */
  });

  // Navigate the explorer's own tree: Standard Floorplans > List Report Page. Expanding the
  // parent node can lazily load that section's child items, so "List Report Page" is waited for
  // explicitly with its own budget rather than relying on .click()'s default one.
  await ui5(page).text('Standard Floorplans', { controlType: 'sap.m.StandardTreeItem' }).click();
  const listReportItem = ui5(page).text('List Report Page', {
    controlType: 'sap.m.StandardTreeItem',
  });
  await listReportItem.waitFor({ timeout: 25000 });
  await listReportItem.click();

  // This explorer app briefly creates one iframe and then replaces it with another shortly after
  // navigating (an app-specific quirk, not something findUi5Frame is meant to protect against -
  // it finds the right frame, not "the frame that's done being replaced"). A frame handle grabbed
  // during that swap detaches out from under the very next call, so this retries the whole
  // find-frame-then-find-table step a couple of times rather than failing on the first hiccup.
  let frame!: Frame;
  let table!: Ui5Locator;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      frame = await findUi5Frame(page, { timeout: 20000 });
      table = ui5(frame).controlType('sap.ui.mdc.Table');
      await table.waitFor({ timeout: 15000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  // The control existing in the DOM and its data actually being bound are different readiness
  // states - waitForUi5 waits for the frame's own in-flight OData request to finish, without
  // which rowCount() can race a still-loading table and read undefined. See docs/auto-wait.md.
  await waitForUi5(frame, { timeout: 20000 }).catch(() => {});

  // The true row count, from the table's own binding - the same "true count, not rendered count"
  // problem Ui5GridTable/Ui5SmartTable solve for their own table families. `expect.poll` because
  // rowCount() itself doesn't auto-wait/retry - same reasoning as every other raw bridge read in
  // this framework (see docs/troubleshooting.md).
  await expect.poll(async () => Ui5MdcTable.rowCount(frame, table), { timeout: 10000 }).toBe(4);
  expect(await Ui5MdcTable.columnHeaders(frame, table)).toEqual(
    expect.arrayContaining(['ID', 'Status']),
  );

  // Filtering: the bulk setFilterConditions()/triggerSearch() API on the filter bar did NOT
  // reliably propagate to the table in testing - the row count stayed at 4 even with a real,
  // valid condition set that way. What's verified to actually work is driving the real rendered
  // filter field, exactly like any other input - `fe::FilterBar::Travel::FilterField::TravelID`
  // is the full local id after this app's one `--` separator (id-suffix matching needs the whole
  // segment, not just its tail - see docs/locators.md).
  const idField = ui5(frame).id('fe::FilterBar::Travel::FilterField::TravelID');
  const input = (await idField.resolve()).locator('input').first();
  await input.fill('1');
  await input.press('Enter');
  await ui5(frame).text('Go', { controlType: 'sap.m.Button' }).click();

  await expect.poll(async () => Ui5MdcTable.rowCount(frame, table), { timeout: 10000 }).toBe(1);
});
