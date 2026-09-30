# Cheat sheet

One page, no explanations - for when you already know this framework (or a teammate does) and
just need the syntax back. First time here? Start with
[docs/getting-started.md](getting-started.md) instead; every line below links to the page that
actually explains it. Every signature here is copied from [docs/api-reference.md](api-reference.md)
(the source of truth) - if the two ever disagree, trust that page, not this one.

```ts
import { test, expect, ui5 } from 'playwright-sapui5';
```

## Locators — [docs/locators.md](locators.md)

```ts
ui5(page).id('welcomeView--submitButton'); // by control id (suffix-matched)
ui5(page).controlType('sap.m.Button'); // by control type
ui5(page).controlType('sap.m.Button', { text: 'OK' }); // + property filter
ui5(page).text('Add to Cart'); // by visible text
ui5(page).text('Add to Cart', { controlType: 'sap.m.Button' }); // scoped - do this whenever more than one control could match
ui5(page).bindingPath('/Products(1)'); // by OData binding path
ui5(page).css('.myCustomClass'); // escape hatch - plain CSS

// Self-healing: primary + fallbacks, tried in order
ui5(page).id('flaky-id').fallback({ by: 'text', text: 'Add to Cart' }, { label: 'add-to-cart' });

await ui5(page).id('x').click();
await ui5(page).id('x').fill('value');
await ui5(page).id('x').resolve(); // → a real Playwright Locator, for anything not wrapped above
```

## Waiting — [docs/auto-wait.md](auto-wait.md)

Every action above already auto-waits (busy indicator + in-flight requests + control tree
settled) before acting. Only reach for these directly when you're not going through a locator:

```ts
import { waitForUi5, waitForUi5Core } from 'playwright-sapui5';
await waitForUi5Core(page); // SAPUI5 has bootstrapped
await waitForUi5(page); // not busy, no pending requests, tree settled
```

## Tables & lists — [docs/ui5-table.md](ui5-table.md), [docs/ui5-grid-table.md](ui5-grid-table.md)

```ts
const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));
await table.rowCount();
await (await table.row(0)).click();
await (await table.rowContaining('Astro Laptop')).click();
await table.cellText(0, 1); // (rowIndex, columnIndex) - both numbers
await table.columnHeaders();

// sap.ui.table.Table (virtualized "grid" table) - separate control, separate class
const grid = await Ui5GridTable.from(ui5(page).controlType('sap.ui.table.Table'));
await grid.rowCount(); // the TRUE count, not just what's currently rendered
await grid.scrollToRow(80);
```

## Dialogs — [docs/ui5-dialog.md](ui5-dialog.md), [docs/value-help-dialog.md](value-help-dialog.md)

```ts
// trigger the dialog first (button click, MessageBox.confirm(), ...), then:
const dialog = await Ui5Dialog.open(page);
await dialog.title();
await dialog.clickButton('OK');
await dialog.waitForClose();

// no `page` argument - the field locator already carries its own target
const vhd = await Ui5ValueHelpDialog.openFor(ui5(page).id('countryInput'));
await vhd.selectRow('Germany');
```

## Dropdowns, dates & tokens — [docs/form-inputs.md](form-inputs.md), [docs/multi-input.md](multi-input.md)

```ts
await Ui5Select.items(page, select); // { key, text, id }[] - readable even closed
await Ui5Select.selectByKey(page, select, 'DE');
await Ui5Select.selectByText(page, combo, 'Germany');
await Ui5Select.selectedKeys(page, multiComboBox); // multi-select variant

await Ui5DatePicker.setDate(page, picker, '2024-03-15'); // or a Date - never a display-format string
await Ui5DatePicker.getDate(page, picker);

await Ui5MultiInput.addByText(page, field, 'Astro Laptop 1516'); // real suggestion flow
await Ui5MultiInput.tokens(page, field); // { id, key, text }[] - key never in the DOM
await Ui5MultiInput.removeByText(page, field, 'Astro Laptop 1516');
```

## Wizards & trees — [docs/wizard.md](wizard.md), [docs/tree.md](tree.md)

```ts
await Ui5Wizard.steps(page, wizard); // { id, title, validated, optional }[]
await Ui5Wizard.currentStepIndex(page, wizard); // 0-based
await Ui5Wizard.next(page, wizard); // clicks that step's own Next button

await Ui5Tree.items(page, tree); // { id, title, level, expanded, leaf }[]
await Ui5Tree.expand(page, tree, 'Node1');
await Ui5Tree.collapseAll(page, tree);
```

## Fiori Elements — [docs/smart-controls.md](smart-controls.md), [docs/mdc-table.md](mdc-table.md)

```ts
// OData V2 (SmartFilterBar / SmartTable) - both instance-based via .from(), like Ui5Table
const filterBar = await Ui5SmartFilterBar.from(
  ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),
);
await filterBar.setFilterData({ Category: 'Laptops' });
await filterBar.search();

const smartTable = await Ui5SmartTable.from(
  ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),
);
await smartTable.rowCount();

// OData V4 (sap.fe - mdc.Table) - static, read-only (see docs/mdc-table.md for why)
await Ui5MdcTable.rowCount(page, mdcTable);
await Ui5MdcTable.columnHeaders(page, mdcTable);

await Ui5ObjectPage.sections(page, objectPage); // { id, title, subSections }[]
await Ui5ObjectPage.scrollToSection(page, objectPage, 'Product Information'); // by TITLE, not id
await Ui5IconTabBar.selectByKey(page, tabBar, 'reviews');
await Ui5VariantManagement.selectByKey(page, variantMgmt, key);
```

## Assertions — [docs/expect-matchers.md](expect-matchers.md)

```ts
await expect(await locator.resolve()).toHaveUi5Property('busy', false);
await expect(await locator.resolve()).toHaveUi5Text('Total: 3 items');
await expect(await locator.resolve()).toBeUi5Busy();
```

## Text, data & messages — [docs/i18n.md](i18n.md), [docs/model-data.md](model-data.md), [docs/messages.md](messages.md)

```ts
await Ui5I18n.getText(page, 'addToCartSuccess'); // assert via the app's own i18n key
await Ui5Model.getBindingContextData(page, rowLocator); // { hasContext, path, data } - the real entity, not rendered text

await Ui5MessageToast.clear(page); // before the action under test
await Ui5MessageToast.waitForText(page, /added to your cart/i); // race-free, even post-auto-hide
await Ui5Messages.all(page); // SAPUI5's central message model
```

## Network & OData — [docs/odata-mocking.md](odata-mocking.md), [docs/odata-client.md](odata-client.md), [docs/odata-seeder.md](odata-seeder.md)

```ts
await mockODataCollection(page, '/Products', products);
await mockODataError(page, '/Products', { status: 400, message: 'Invalid' });

// `request` is Playwright's own built-in fixture (an APIRequestContext) - destructure it
// alongside `page` in the test callback: test('...', async ({ page, request }) => { ... })
const client = await Ui5ODataClient.create(request, '/sap/opu/odata/...');
await client.create('Products', { Name: 'Test' });

const seeder = Ui5ODataSeeder.fromClient(client); // or Ui5ODataSeeder.create(request, url)
await seeder.seed('Products', { Name: 'Test' });
await seeder.cleanup(); // LIFO, always call in an afterEach/finally
```

## Navigation, performance & content density — [docs/navigation.md](navigation.md), [docs/performance.md](performance.md), [docs/content-density.md](content-density.md)

```ts
await Ui5Navigation.navTo(page, 'productDetail', { id: '42' }); // via the app's real router
await Ui5Performance.measureBootstrap(page, url);
await Ui5ContentDensity.set(page, 'compact');
```

## CLI — [docs/init.md](init.md), [docs/generator.md](generator.md), [docs/doctor.md](doctor.md)

```bash
npx pw-sapui5 init --base-url <url> --ci github        # scaffold a whole project (--ci azure|gitlab|none)
npx pw-sapui5 generate --url <url> -o pages/X.ts -c X   # Page Object from a running app
npx pw-sapui5 generate-tests --url <url> -o gen.spec.ts # starter test suite from a running app
npx pw-sapui5 doctor --url <url>                        # zero-code CI smoke check, exit-code gated
```

## When something doesn't work

→ [docs/troubleshooting.md](troubleshooting.md) - the recurring gotchas (stale ids, `NavContainer`
keeping a hidden previous page in the DOM, a control type that looks right but isn't rendered
yet) are all there, each with the fix.
