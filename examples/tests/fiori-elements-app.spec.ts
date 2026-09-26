import { test, expect } from '../../src';
import { ui5, Ui5SmartFilterBar, Ui5SmartTable, Ui5Table } from '../../src';

// A real, complete Fiori Elements app from the SAPUI5 SDK's own "Demo Apps" catalog - not an
// isolated single-control sample like the rest of examples/tests/, but a full smart-template-
// generated List Report + Object Page, the way a real Fiori Elements app actually looks: a
// SmartFilterBar and SmartTable on the list, an ObjectPageLayout with IconTabBar sections and
// nested tables on the detail page. See docs/demo-apps.md.
const MANAGE_PRODUCTS_URL =
  'https://ui5.sap.com/test-resources/sap/suite/ui/generic/template/demokit/sample.manage.products.sepmra/test/index.html?sap-ui-theme=sap_horizon#masterDetail-display';

test.describe('Fiori Elements List Report + Object Page (Manage Products)', () => {
  test('search the list report, open a product, and read its Object Page', async ({ page }) => {
    await page.goto(MANAGE_PRODUCTS_URL);

    // Unlike the isolated SmartFilterBar/SmartTable SDK sample (docs/smart-controls.md), this
    // list report starts with no default filter applied at all - `search()` with an empty filter
    // is exactly what clicking "Go" on a blank filter bar does in a real app: return everything.
    const filterBar = await Ui5SmartFilterBar.from(
      ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),
    );
    const smartTable = await Ui5SmartTable.from(
      ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),
    );

    await filterBar.search({ timeout: 20000 });
    expect(await smartTable.rowCount()).toBeGreaterThan(0);

    // This app's list report happens to render as a plain sap.m.Table (unlike the SmartTable SDK
    // sample, which used a virtualized sap.ui.table.Table) - always check innerTableType() rather
    // than assuming one or the other; see docs/smart-controls.md.
    expect(await smartTable.innerTableType()).toBe('sap.m.Table');
    const table = await Ui5Table.from(await smartTable.innerTableLocator());

    // Clicking a list report row navigates to that product's Object Page - a real Fiori Elements
    // routing transition (the URL hash changes to include the product's key), not a dialog or
    // panel toggle. Row 0's default sort is stable in this live demo (verified across repeated
    // runs) - always "Notebook Basic 15" (HT-2001).
    const row = await table.row(0);
    await row.click();

    // The Object Page header title - read the same way as any other control, no special
    // "detail page" API needed. `.resolve()` turns the Ui5Locator into a plain Playwright Locator
    // so Playwright's own `toBeVisible()` assertion can use it. Note: the list report stays
    // mounted behind the Object Page (the same `NavContainer`-keeps-previous-pages behavior
    // documented in docs/troubleshooting.md), so a plain text search for something that also
    // appears in the list (like "In stock") would match more than one element - `controlType`
    // narrows this one down to the page's own title specifically.
    await expect(
      await ui5(page).text('Notebook Basic 15', { controlType: 'sap.m.Title' }).resolve(),
    ).toBeVisible();

    // The Object Page is organized into IconTabBar sections ("Supplier Information", "Product
    // Information", "Reviews", "Inventory Information") - switching sections is an ordinary click,
    // same as any other tab control.
    await ui5(page).text('Product Information', { controlType: 'sap.m.IconTabFilter' }).click();
    await expect(await ui5(page).text('Technical Data').resolve()).toBeVisible();
  });
});
