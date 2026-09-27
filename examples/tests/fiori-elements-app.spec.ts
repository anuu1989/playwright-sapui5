import { test, expect } from '../../src';
import {
  ui5,
  Ui5IconTabBar,
  Ui5ObjectPage,
  Ui5SmartFilterBar,
  Ui5SmartTable,
  Ui5Table,
  Ui5VariantManagement,
} from '../../src';

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

  test('Ui5ObjectPage and Ui5IconTabBar read and drive the same Object Page', async ({ page }) => {
    await page.goto(MANAGE_PRODUCTS_URL);

    const filterBar = await Ui5SmartFilterBar.from(
      ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),
    );
    const smartTable = await Ui5SmartTable.from(
      ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),
    );
    await filterBar.search({ timeout: 20000 });
    const table = await Ui5Table.from(await smartTable.innerTableLocator());
    await (await table.row(0)).click();

    const objectPage = ui5(page).controlType('sap.uxap.ObjectPageLayout');
    await objectPage.waitFor({ timeout: 15000 });

    const sections = await Ui5ObjectPage.sections(page, objectPage);
    expect(sections.map((s) => s.title)).toEqual([
      'Header',
      'Supplier Information',
      'Product Information',
      'Reviews',
      'Inventory Information',
    ]);

    const target = sections.find((s) => s.title === 'Product Information')!;
    await Ui5ObjectPage.scrollToSection(page, objectPage, 'Product Information');
    expect(await Ui5ObjectPage.selectedSection(page, objectPage)).toBe(target.id);

    // This Object Page's anchor bar renders as a bare `sap.m.IconTabHeader`, not the full
    // `sap.m.IconTabBar` - see docs/icon-tab-bar.md. The SDK's own documentation shell around
    // this app renders an unrelated IconTabHeader of its own (its demo-navigation chrome), so
    // `.id(...)` scopes to the Object Page's own one by the local id SAPUI5 gives it -
    // `objectPage-anchBar`, the whole segment after the last `--`, not just `anchBar` (id-suffix
    // matching requires the full `--<localId>` segment; see docs/locators.md).
    const anchorBar = ui5(page).id('objectPage-anchBar');
    const items = await Ui5IconTabBar.items(page, anchorBar);
    expect(items.map((item) => item.text)).toEqual([
      'Supplier Information',
      'Product Information',
      'Reviews',
      'Inventory Information',
    ]);
    // scrollToSection above already switched the active tab too - both controls read the same
    // underlying state.
    expect(await Ui5IconTabBar.selectedKey(page, anchorBar)).toBe(target.id);

    const reviews = items.find((item) => item.text === 'Reviews')!;
    await Ui5IconTabBar.selectByKey(page, anchorBar, reviews.key!);
    expect(await Ui5IconTabBar.selectedKey(page, anchorBar)).toBe(reviews.key);
    expect(await Ui5ObjectPage.selectedSection(page, objectPage)).toBe(reviews.key);
  });

  test('variant management: read the saved variants and the active one', async ({ page }) => {
    await page.goto(MANAGE_PRODUCTS_URL);

    // Every Fiori list report has this control at the top - the "Standard" dropdown that saves
    // filter/column/sort configurations. SAPUI5 stacks two controls here with the same concept
    // under different method names; Ui5VariantManagement reads whichever one it's given.
    const variantManagement = ui5(page).controlType(
      'sap.ui.comp.smartvariants.SmartVariantManagement',
    );
    await variantManagement.waitFor({ timeout: 20000 });

    const variants = await Ui5VariantManagement.variants(page, variantManagement);
    expect(variants).toEqual(expect.arrayContaining([{ key: '*standard*', text: 'Standard' }]));

    expect(await Ui5VariantManagement.currentName(page, variantManagement)).toBe('Standard');

    // Activating a variant re-applies its whole configuration, so selectByName waits for the app
    // to settle afterwards rather than returning into a mid-rebind page.
    await Ui5VariantManagement.selectByName(page, variantManagement, 'Standard');
    expect(await Ui5VariantManagement.currentKey(page, variantManagement)).toBe('*standard*');

    await expect(
      Ui5VariantManagement.selectByName(page, variantManagement, 'No Such Variant'),
    ).rejects.toThrow(/no variant named/);
  });
});
