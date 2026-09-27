# How-to: every feature, as a task

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code below looks unfamiliar.

Every other page in these docs is organised around a **feature**. This one is organised around
the **question you actually have**. Find your question, copy the snippet, then follow the link if
you need the detail behind it.

Every snippet here is drawn from code that runs in this repo's own passing test suite, against
real public SAPUI5 apps. Where a feature has a trap in it, the trap is called out with the
snippet rather than left in the deep-dive page.

Assume this import at the top of each snippet:

```ts
import { test, expect, ui5 } from 'playwright-sapui5';
```

## Index

| I want to…                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Set up a project from scratch](#how-do-i-set-up-a-project-from-scratch)                                                                             |
| [Write my first test against an existing project](#how-do-i-write-my-first-test)                                                                     |
| [Find a control](#how-do-i-find-a-control)                                                                                                           |
| [Stop a locator breaking every release](#how-do-i-stop-a-locator-breaking-every-release)                                                             |
| [Track which locators are healing across a run](#how-do-i-track-which-locators-are-healing-across-a-run)                                             |
| [Wait for the app to be ready](#how-do-i-wait-for-the-app-to-be-ready)                                                                               |
| [Organise a growing suite](#how-do-i-organise-a-growing-suite)                                                                                       |
| [Assert on a control's real state](#how-do-i-assert-on-a-controls-real-state)                                                                        |
| [Read rows and cells from a table or list](#how-do-i-read-rows-and-cells-from-a-table-or-list)                                                       |
| [Handle a virtualized grid table](#how-do-i-handle-a-virtualized-grid-table)                                                                         |
| [Work with a dialog](#how-do-i-work-with-a-dialog)                                                                                                   |
| [Use a value help (F4) dialog](#how-do-i-use-a-value-help-f4-dialog)                                                                                 |
| [Test a Fiori Elements list report](#how-do-i-test-a-fiori-elements-list-report)                                                                     |
| [Switch a saved variant](#how-do-i-switch-a-saved-variant)                                                                                           |
| [Pick from a dropdown](#how-do-i-pick-from-a-dropdown)                                                                                               |
| [Set a date](#how-do-i-set-a-date)                                                                                                                   |
| [Assert text that survives translation](#how-do-i-assert-text-that-survives-translation)                                                             |
| [Assert on real data instead of display text](#how-do-i-assert-on-real-data-instead-of-display-text)                                                 |
| [Catch a toast that already vanished](#how-do-i-catch-a-toast-that-already-vanished)                                                                 |
| [Catch validation and backend errors](#how-do-i-catch-validation-and-backend-errors)                                                                 |
| [Deal with the multi-column Fiori shell](#how-do-i-deal-with-the-multi-column-fiori-shell)                                                           |
| [Read and navigate a Fiori Elements Object Page's sections](#how-do-i-read-and-navigate-a-fiori-elements-object-pages-sections)                      |
| [Read the tabs and badge counts on a tab strip](#how-do-i-read-the-tabs-and-badge-counts-on-a-tab-strip)                                             |
| [Read the classic master/detail shell's state](#how-do-i-read-the-classic-masterdetail-shells-state)                                                 |
| [Jump straight to a route](#how-do-i-jump-straight-to-a-route)                                                                                       |
| [Measure how slow the app is](#how-do-i-measure-how-slow-the-app-is)                                                                                 |
| [Work out why a test failed](#how-do-i-work-out-why-a-test-failed)                                                                                   |
| [Mock an OData backend](#how-do-i-mock-an-odata-backend)                                                                                             |
| [Check a mock against the real backend's actual schema](#how-do-i-check-a-mock-against-the-real-backends-actual-schema)                              |
| [Seed or clean up backend data without going through the UI](#how-do-i-seed-or-clean-up-backend-data-without-going-through-the-ui)                   |
| [Test an app inside an iframe](#how-do-i-test-an-app-inside-an-iframe)                                                                               |
| [Generate tests or Page Objects from a URL](#how-do-i-generate-tests-or-page-objects-from-a-url)                                                     |
| [Report results to Jira](#how-do-i-report-results-to-jira)                                                                                           |
| [Check that an environment is even healthy first](#how-do-i-check-that-an-environment-is-even-healthy-first)                                         |
| [Log in once and reuse the session](#how-do-i-log-in-once-and-reuse-the-session)                                                                     |
| [Point tests at dev/QA/prod](#how-do-i-point-tests-at-devqaprod)                                                                                     |
| [Check accessibility](#how-do-i-check-accessibility)                                                                                                 |
| [Catch visual regressions](#how-do-i-catch-visual-regressions)                                                                                       |
| [Stop a live clock or timestamp from making a screenshot test flaky](#how-do-i-stop-a-live-clock-or-a-timestamp-from-making-a-screenshot-test-flaky) |

---

## Getting started

### How do I set up a project from scratch?

One command scaffolds config, tsconfig, an example Page Object and spec, `.env.example` and VS
Code settings:

```bash
mkdir my-tests && cd my-tests && npm init -y
npm install --save-dev playwright-sapui5 @playwright/test dotenv typescript @types/node
npx pw-sapui5 init --base-url https://your-app.example.com/
npx playwright install chromium
npx playwright test
```

→ [init.md](init.md)

### How do I write my first test?

Import `test`/`expect` from this package instead of `@playwright/test`. They're drop-in
replacements that add UI5 auto-waiting and UI5 matchers:

```ts
import { test, expect, ui5 } from 'playwright-sapui5';

test('the category list loads', async ({ page }) => {
  await page.goto('https://your-app.example.com/');

  const list = ui5(page).controlType('sap.m.List');
  await expect(await list.resolve()).toBeVisible();
});
```

**The one trap:** a `Ui5Locator` isn't a Playwright `Locator`. For Playwright's own matchers, call
`.resolve()` first, as above. This package's own matchers (`toHaveUi5Property`, `toHaveUi5Text`,
`toBeUi5Busy`) accept either.

→ [getting-started.md](getting-started.md)

## Finding and waiting

### How do I find a control?

Six strategies, in rough order of how often you'll want them:

```ts
ui5(page).text('Laptops', { controlType: 'sap.m.StandardListItem' }); // visible text
ui5(page).controlType('sap.m.Button', { icon: 'sap-icon://cart-3' }); // type + properties
ui5(page).id('category--page-title'); // id suffix, not the full generated id
ui5(page).bindingPath('/Products/0'); // OData binding path
ui5(page).role('button', 'Save'); // ARIA role + accessible name
ui5(page).css('.sapMListTblRow'); // plain CSS, as a last resort
```

Scoping by `controlType` is what makes a text match unambiguous - the same string often appears on
both a row and a title inside it.

→ [locators.md](locators.md)

### How do I stop a locator breaking every release?

Chain fallbacks. If the primary strategy misses, the next is tried and a warning is logged, so the
test passes _and_ you learn the primary needs attention:

```ts
const search = ui5(page)
  .id('nonExistentSearchFieldId')
  .fallback({ by: 'controlType', controlType: 'sap.m.SearchField' })
  .as('Search field'); // .as() names it in warnings and errors

await search.fill('laptop');
```

To log every heal across the whole suite centrally:

```ts
import { SelfHealingResolver } from 'playwright-sapui5';

const unsubscribe = SelfHealingResolver.onHeal((event) => console.log(event));
```

→ [locators.md](locators.md#self-healing-fallback-strategies)

### How do I track which locators are healing across a run?

`onHeal()` above is a live event - useful while watching one test, but it runs in a worker
process, so subscribing to it from a reporter hears nothing. Register the aggregation reporter
instead:

```ts
// playwright.config.ts
reporter: [['list'], ['playwright-sapui5/reporter/health']],
```

No change to existing tests needed. If anything healed, the run prints:

```
[playwright-sapui5] 1 self-heal(s) across 1 locator(s) - the primary strategy needs attention:
  1x  Laptops category (deliberately broken primary strategy)  (1 test(s))
        healed via {"by":"text","text":"Laptops","controlType":"sap.m.StandardListItem"}  (1x)
```

A locator that heals once is a warning; one that heals on every run is already broken and only
passing because its fallback does the real work. `outputFile` writes the aggregation as JSON for
diffing against a previous run; `failOnHeal: true` turns an otherwise-green run red.

→ [locator-health.md](locator-health.md)

### How do I wait for the app to be ready?

Usually you don't - every action already waits for the busy indicator to clear, in-flight requests
to settle, and the control tree to stop changing. When you need it explicitly (typically before a
raw read that bypasses locators):

```ts
import { waitForUi5, waitForUi5Core } from 'playwright-sapui5';

await page.goto(APP_URL);
await waitForUi5Core(page); // the SAPUI5 runtime has bootstrapped
await waitForUi5(page); // …and the app has settled
```

**If a raw read is flaky**, don't raise the timeout - wait for the thing itself:

```ts
const rows = ui5(page).controlType('sap.m.ColumnListItem');
await rows.waitFor(); // a real row exists…
await expect.poll(async () => rows.count()).toBeGreaterThan(0);
```

→ [auto-wait.md](auto-wait.md)

### How do I organise a growing suite?

Subclass `Ui5Page`. The locator helpers are `protected`, so the Page Object's public surface stays
a list of intentions rather than selectors:

```ts
import { Ui5Page } from 'playwright-sapui5';

export class CartPage extends Ui5Page {
  async open() {
    await this.goto('https://your-app.example.com/'); // navigates + waits for boot
  }

  get categoryList() {
    return this.controlType('sap.m.List').as('Category list');
  }

  category(name: string) {
    return this.text(name, { controlType: 'sap.m.StandardListItem' }).as(`Category: ${name}`);
  }

  async selectCategory(name: string) {
    await this.category(name).click();
  }
}
```

→ [page-objects.md](page-objects.md)

## Asserting

### How do I assert on a control's real state?

Three matchers read the control's own live properties through the bridge, not its rendered DOM.
They auto-retry and support `.not`, like Playwright's built-ins:

```ts
await expect(cart.categoryList).toHaveUi5Property('headerText', 'Categories');
await expect(cart.category('Laptops')).toHaveUi5Text('Laptops');
await expect(cart.categoryList).not.toBeUi5Busy();
```

This is how you assert on things with no DOM representation at all - `selectedKey`, `enabled`,
`valueState`, a custom property.

→ [expect-matchers.md](expect-matchers.md)

## Tables, lists and dialogs

### How do I read rows and cells from a table or list?

```ts
import { Ui5Table } from 'playwright-sapui5';

const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));

expect(await table.rowCount()).toBeGreaterThan(0);
expect(await table.columnHeaders()).toContain('Product');
expect(await table.cellText(0, 1)).toBe('Notebook Basic 15');

const row = await table.rowContaining('Notebook Basic 15');
await row.click();
```

**Two traps worth knowing before you hit them.** `from()` auto-detects the row control type, and on
a list with a "load more" trigger or a "no data" placeholder it can latch onto the wrong one - so
wait for a real row first, and pass `rowControlType` when you know it:

```ts
const masterList = ui5(page).controlType('sap.m.List');
await ui5(page).controlType('sap.m.ObjectListItem').waitFor();
const list = await Ui5Table.from(masterList, { rowControlType: 'sap.m.ObjectListItem' });
```

`cellText()` and `columnHeaders()` are `sap.m.Table` only - a `sap.m.List` has no columns.

→ [ui5-table.md](ui5-table.md)

### How do I handle a virtualized grid table?

`sap.ui.table.Table` is a different control with a fixed pool of reused rows, so "how many rows are
there" and "how many are rendered" are different questions. `Ui5GridTable` answers both:

```ts
import { Ui5GridTable } from 'playwright-sapui5';

const table = await Ui5GridTable.from(ui5(page).controlType('sap.ui.table.Table'));

expect(await table.rowCount()).toBe(123); // all of them, per the binding
expect(await table.renderedRowCount()).toBeLessThan(123); // only these exist in the DOM

await table.scrollToRow(100); // bring an off-screen row into the pool
expect(await table.cellText(100, 0)).toBeTruthy();
```

→ [ui5-grid-table.md](ui5-grid-table.md)

### How do I work with a dialog?

`Ui5Dialog.open()` waits for whatever popup is opening and hands you a handle to it - you don't
need its generated id:

```ts
import { Ui5Dialog } from 'playwright-sapui5';

await ui5(page).text('Sort', { controlType: 'sap.m.Button' }).click();

const dialog = await Ui5Dialog.open(page);
expect(await dialog.title()).toBe('View Settings');
await dialog.clickButton('OK');
await dialog.waitForClose();
```

Button lookup is scoped to the dialog, which is what stops "OK" matching a button on the page
behind it.

→ [ui5-dialog.md](ui5-dialog.md)

### How do I use a value help (F4) dialog?

Point it at the field, not the dialog. It finds the trigger icon, opens it, and works with whatever
result list turns up - `sap.m.Table`, `sap.m.List` or a virtualized grid table:

```ts
import { Ui5ValueHelpDialog } from 'playwright-sapui5';

const field = ui5(page).controlType('sap.m.Input');
const dialog = await Ui5ValueHelpDialog.openFor(field);

await dialog.selectRow('Notebook Basic 15');
await expect(field).toHaveUi5Property('value', 'Notebook Basic 15');
```

→ [value-help-dialog.md](value-help-dialog.md)

## Fiori Elements

### How do I test a Fiori Elements list report?

`setFilterData`'s keys are OData property names, not field labels. For a plain text/date field, a
bare value works:

```ts
import { Ui5SmartFilterBar, Ui5SmartTable, Ui5Table } from 'playwright-sapui5';

const filterBar = await Ui5SmartFilterBar.from(
  ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),
);
await filterBar.setFilterData({ CompanyCode: '0001' });
await filterBar.search();

const smartTable = await Ui5SmartTable.from(
  ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),
);
expect(await smartTable.rowCount()).toBeGreaterThan(0);

// Need rows and cells? Get the inner table and wrap it - innerTableType() tells you which.
const inner = await Ui5Table.from(await smartTable.innerTableLocator());
```

**The trap:** a _token-based_ field (rendered as a `MultiInput` with removable tokens - common for
value-help-backed properties, including `CompanyCode` above) silently ignores a bare value.
`setFilterData` needs the whole `{ value, ranges, items }` shape `getFilterData()` itself returns
for that field:

```ts
await filterBar.setFilterData({
  CompanyCode: {
    value: null,
    ranges: [
      { exclude: false, operation: 'EQ', keyField: 'CompanyCode', value1: '9999', value2: '9999' },
    ],
    items: [],
  },
});
```

It won't throw either way - `getFilterData()` even echoes the bare value back - it just doesn't
affect `search()`. If a filter doesn't seem to work, call `getFilterData()` first and mirror the
shape it already uses for that field.

→ [smart-controls.md](smart-controls.md#setfilterdata-needs-the-right-shape-per-field)

### How do I switch a saved variant?

```ts
import { Ui5VariantManagement } from 'playwright-sapui5';

const vm = ui5(page).controlType('sap.ui.comp.smartvariants.SmartVariantManagement');

expect(await Ui5VariantManagement.currentName(page, vm)).toBe('Standard');
const variants = await Ui5VariantManagement.variants(page, vm);
await Ui5VariantManagement.selectByName(page, vm, 'Standard');
```

This covers both variant controls - the `sap.ui.comp` one and `sap.m.VariantManagement` - which
have entirely different method names underneath.

→ [variant-management.md](variant-management.md)

## Form inputs

### How do I pick from a dropdown?

A dropdown's options don't exist in the DOM until it opens, and once open the clickable entries
carry no keys. `Ui5Select` reads the real items and picks by text or key regardless:

```ts
import { Ui5Select } from 'playwright-sapui5';

const select = ui5(page).controlType('sap.m.Select');

// Poll first: items() reads the control once, so a still-binding list reads as empty.
await expect.poll(async () => (await Ui5Select.items(page, select)).length).toBeGreaterThan(1);

const items = await Ui5Select.items(page, select);
await Ui5Select.selectByKey(page, select, items[0].key!);
expect(await Ui5Select.selectedKey(page, select)).toBe(items[0].key);
```

Works for `Select`, `ComboBox` and `MultiComboBox`. For a multi-select, use `selectedKeys()` and
call `close()` when you're done adding:

```ts
await Ui5Select.selectByText(page, multi, 'Germany');
await Ui5Select.selectByText(page, multi, 'Argentina');
await Ui5Select.close(page, multi);
expect(await Ui5Select.selectedKeys(page, multi)).toHaveLength(2);
```

→ [form-inputs.md](form-inputs.md)

### How do I set a date?

Pass a `Date` or an ISO `'YYYY-MM-DD'` string - never the locale's display format, which varies by
user:

```ts
import { Ui5DatePicker } from 'playwright-sapui5';

const picker = ui5(page).controlType('sap.m.DatePicker');
await Ui5DatePicker.setDate(page, picker, '2024-03-15');

const { date, displayValue } = await Ui5DatePicker.getDate(page, picker);
expect(date?.getDate()).toBe(15);
```

`'15/03/2024'` throws deliberately rather than silently guessing. Use `typeDate()` when you
specifically want to test what typing into the field does, including bad input.

→ [form-inputs.md](form-inputs.md)

## Data, text and messages

### How do I assert text that survives translation?

Assert with the app's own i18n key, so the test passes in any locale:

```ts
import { Ui5I18n } from 'playwright-sapui5';

const expected = await Ui5I18n.getText(page, 'homeTitle');
await expect(ui5(page).controlType('sap.m.Title')).toHaveUi5Text(expected);

// Placeholders:
await Ui5I18n.getText(page, 'priceKey', { args: [0, 100] }); // 'Price (0 - 100 EUR)'
```

`getText()` **throws** on a missing key rather than returning the key itself, which is what makes a
renamed key a visible failure. Use `hasText()` when a key's absence is a legitimate outcome.

→ [i18n.md](i18n.md)

### How do I assert on real data instead of display text?

Rendered text is formatted and localized - `"1.234,56 €"` for the number `1234.56`. Read the model
instead:

```ts
import { Ui5Model } from 'playwright-sapui5';

const row = ui5(page).controlType('sap.m.StandardListItem');
const { hasContext, path, data } = await Ui5Model.getBindingContextData(page, row);

// …or one property, by path:
const name = await Ui5Model.getProperty(page, `${path}/CategoryName`);
```

`listModels(page)` is the quickest way to see what models an app actually has when you're
exploring.

→ [model-data.md](model-data.md)

### How do I catch a toast that already vanished?

A `MessageToast` auto-hides after ~3 seconds and has no control id, so racing it with a DOM
assertion is hopeless. This framework records toasts as the app raises them, so you can assert
after the fact:

```ts
import { Ui5MessageToast } from 'playwright-sapui5';

await Ui5MessageToast.clear(page); // ignore anything from earlier in the test
await addToCartButton.click();

const toast = await Ui5MessageToast.waitForText(page, /added to your shopping cart/i);
expect(await Ui5MessageToast.texts(page)).toContain(toast);
```

→ [messages.md](messages.md)

### How do I catch validation and backend errors?

SAPUI5 collects both in a central message model - including errors the UI never displays anywhere:

```ts
import { Ui5Messages } from 'playwright-sapui5';

expect(await Ui5Messages.errors(page)).toEqual([]); // a strong smoke-test assertion

const message = await Ui5Messages.waitForMessage(page, /required/i, { type: 'Error' });
```

Asserting `errors()` is empty after a happy-path flow catches a whole class of silent OData
failures that a visual check misses.

→ [messages.md](messages.md)

## Layout, navigation and performance

### How do I deal with the multi-column Fiori shell?

All three columns always exist in the DOM, so counting visible columns from markup is meaningless.
Ask the control:

```ts
import { Ui5FlexibleColumnLayout } from 'playwright-sapui5';

expect(await Ui5FlexibleColumnLayout.layout(page)).toBe('TwoColumnsMidExpanded');
expect(await Ui5FlexibleColumnLayout.visibleColumnCount(page)).toBe(2);

const { begin, mid, end } = await Ui5FlexibleColumnLayout.currentPages(page);
await Ui5FlexibleColumnLayout.setLayout(page, 'OneColumn');
```

The locator argument is optional - an app essentially always has exactly one of these.

→ [flexible-column-layout.md](flexible-column-layout.md)

### How do I read and navigate a Fiori Elements Object Page's sections?

```ts
import { Ui5ObjectPage } from 'playwright-sapui5';

const objectPage = ui5(page).controlType('sap.uxap.ObjectPageLayout');

const sections = await Ui5ObjectPage.sections(page, objectPage);
await Ui5ObjectPage.scrollToSection(page, objectPage, 'Product Information');
expect(await Ui5ObjectPage.selectedSection(page, objectPage)).toBe(
  sections.find((s) => s.title === 'Product Information')!.id,
);
```

Works the same whether the page renders sections as tabs or as one long scrollable page with an
anchor bar - both are driven by the same `scrollToSection()` under the hood.

→ [object-page.md](object-page.md)

### How do I read the tabs and badge counts on a tab strip?

```ts
import { Ui5IconTabBar } from 'playwright-sapui5';

const tabs = ui5(page).controlType('sap.m.IconTabHeader'); // what a Fiori Elements Object Page renders
const items = await Ui5IconTabBar.items(page, tabs);
await Ui5IconTabBar.selectByKey(page, tabs, items[1].key!);
```

**The trap:** a Fiori Elements Object Page's tab strip is a bare `sap.m.IconTabHeader`, not the
full `sap.m.IconTabBar` - confirmed against a real one. Both work with this class; search for
whichever one the app actually renders.

→ [icon-tab-bar.md](icon-tab-bar.md)

### How do I read the classic master/detail shell's state?

```ts
import { Ui5SplitApp } from 'playwright-sapui5';

expect(await Ui5SplitApp.mode(page)).toBe('ShowHideMode');
const { master, detail } = await Ui5SplitApp.currentPages(page);
```

For `sap.m.SplitApp` - the older, simpler sibling of `Ui5FlexibleColumnLayout` above, same idea: a
hidden master page can mean "collapsed behind a toggle" rather than "not showing", and the mode
tells you which.

→ [split-app.md](split-app.md)

### How do I jump straight to a route?

Skip the click-through when the navigation isn't what you're testing:

```ts
import { Ui5Navigation } from 'playwright-sapui5';

await Ui5Navigation.navTo(page, 'category', { id: 'LT' });
await Ui5Navigation.waitForHash(page, '/category/LT');
```

**Always pair the two.** SAPUI5's own `navTo` does _nothing_ for an unknown route rather than
throwing, so without `waitForHash` a renamed route passes silently.

→ [navigation.md](navigation.md)

### How do I measure how slow the app is?

`load` fires long before a UI5 app is usable. This measures the part users feel:

```ts
import { Ui5Performance } from 'playwright-sapui5';

const timings = await Ui5Performance.measureBootstrap(page, APP_URL);
expect(timings.settledMs).toBeLessThan(15000); // navigationMs, coreReadyMs, settledMs

const metrics = await Ui5Performance.metrics(page); // controlCount, UI5 version, request counts
```

Set the budget at roughly 3× your measured baseline: high enough to survive a slow CI runner, low
enough to catch a real regression.

→ [performance.md](performance.md)

## Diagnosing and faking

### How do I work out why a test failed?

Nothing to do - when a test that imports `test` from this package fails, the SAPUI5 control tree is
attached to the report automatically: every control that was actually rendered, with type and text.
Open `ui5-control-tree.txt` in the HTML report.

To capture it at a moment of your choosing:

```ts
import { captureControlTree } from 'playwright-sapui5';

const { dump, text } = await captureControlTree(page);
console.log(text);
```

→ [diagnostics.md](diagnostics.md), [troubleshooting.md](troubleshooting.md)

### How do I mock an OData backend?

The envelope shapes differ between V2 and V4, and getting one wrong makes `ODataModel` fail in
confusing ways. These build the right one:

```ts
import {
  mockODataCollection,
  mockODataEntity,
  mockODataError,
  mockODataBatch,
} from 'playwright-sapui5';

await mockODataCollection(page, '**/Products', [{ ProductID: '1', Name: 'Widget' }]);
await mockODataEntity(page, "**/Products('1')", { ProductID: '1', Name: 'Widget' });
await mockODataError(page, '**/Fail', { status: 500, message: 'Service unavailable' });
await mockODataCollection(page, '**/ProductsV4', [{ ProductID: '3' }], { version: 'v4' });
```

**Real Fiori apps usually need `mockODataBatch`**, because `ODataModel` v2 defaults to
`useBatch: true` - individual endpoint mocks are never hit. Parts are matched positionally to the
requests embedded in the batch:

```ts
await mockODataBatch(page, '**/svc/$batch', [
  { data: [{ ProductID: '1' }] },
  { data: { ProductID: '1' } },
]);
```

→ [odata-mocking.md](odata-mocking.md)

### How do I check a mock against the real backend's actual schema?

```ts
import { fetchODataMetadata, mockODataCollection } from 'playwright-sapui5';

const metadata = await fetchODataMetadata('https://your-service/$metadata');
await mockODataCollection(page, '**/Products', data, { metadata, entityType: 'Product' });
```

Throws immediately, naming the exact property, if `data` doesn't match `Product`'s real shape on
the actual service - a typo'd or renamed field caught at test-setup time instead of as a confusing
binding failure inside the app. Deliberately lenient about OData's known serialization quirks
(`Edm.Decimal`/`Edm.Int64` as quoted strings), so it won't false-flag correctly-shaped data.

→ [odata-metadata.md](odata-metadata.md)

### How do I seed or clean up backend data without going through the UI?

```ts
import { Ui5ODataClient } from 'playwright-sapui5';

const odata = await Ui5ODataClient.create(page.request, 'https://your-service/odata/v2/MyService');
await odata.create('Products', { ProductID: 'P1', Name: 'Widget' });
// ... test opens the app and finds Product P1 already there ...
await odata.delete("Products('P1')"); // clean up regardless of how the test went
```

Handles SAP Gateway's CSRF handshake for you - a `GET` with `X-CSRF-Token: Fetch`, then that token
attached to every write. Pass `page.request` specifically and the call reuses the page's own
session cookies, so it's already authenticated as whatever the page is logged in as.

**The trap:** `page.route()` does **not** mock a backend for this - it only intercepts requests
the browser page makes, and `Ui5ODataClient` calls go straight from Node. Use a real (if local)
HTTP server to fake a backend for it instead.

→ [odata-client.md](odata-client.md)

### How do I test an app inside an iframe?

Fiori Launchpad loads apps in iframes. Find the frame once, then use it exactly as you'd use
`page` - every locator, wait and helper accepts either:

```ts
import { findUi5Frame, waitForUi5 } from 'playwright-sapui5';

await page.goto(LAUNCHPAD_URL);
const appFrame = await findUi5Frame(page); // the frame with its own ready UI5 runtime

await waitForUi5(appFrame);
await ui5(appFrame).text('Laptops', { controlType: 'sap.m.StandardListItem' }).click();
```

→ [cross-frame.md](cross-frame.md)

## Tooling

### How do I generate tests or Page Objects from a URL?

Point either generator at a **running** app:

```bash
# A runnable starter suite: smoke test, startup budget, one test per navigable route
npx pw-sapui5 generate-tests --url https://your-app.example.com/ --output tests/app.spec.ts

# A starter Page Object from the live control tree
npx pw-sapui5 generate --url https://your-app.example.com/ \
  --output pages/ProductListPage.ts --class-name ProductListPage
```

Add `--headed` for an app behind a login, and `--timeout 60000` for a slow one. Both write a
starting point meant to be edited and committed - `generate-tests` deliberately clicks nothing,
because it can't tell "Show Details" from "Delete Order".

→ [test-generator.md](test-generator.md), [generator.md](generator.md), full CLI options in the
[README](../README.md#cli-reference)

### How do I report results to Jira?

Set credentials in the environment, add the reporter, and reference issues from your tests:

```bash
export JIRA_BASE_URL="https://your-org.atlassian.net"
export JIRA_EMAIL="you@your-company.com"
export JIRA_API_TOKEN="your-api-token"
export JIRA_PROJECT_KEYS="ABC"
```

```ts
// playwright.config.ts
reporter: [['list'], ['playwright-sapui5/reporter/jira']],
```

```ts
test('checkout completes', { annotation: { type: 'jira', description: 'ABC-123' } }, async () => {
  /* ... */
});
```

Each referenced issue gets a run summary comment. Set `createIssueOnFailure: true` to also file
bugs, with the control tree attached. **Run it once with `dryRun: true` first** - it logs exactly
what it would post without touching Jira.

→ [jira.md](jira.md)

### How do I check that an environment is even healthy first?

One command, no test file - bootstraps, renders controls, settles within budget, no message-model
errors:

```bash
npx pw-sapui5 doctor --url https://your-app.example.com/
```

Exits `0` when healthy, `1` otherwise, with each check reported on its own line - drop it into a
CI step before the real suite runs, so a broken environment fails fast with a reason instead of
producing a wall of unrelated test failures.

→ [doctor.md](doctor.md)

## Cross-cutting recipes

### How do I log in once and reuse the session?

Authenticate in a setup project, save the storage state, and let every other test start logged in.

→ [authentication.md](authentication.md)

### How do I point tests at dev/QA/prod?

Keep URLs and credentials in env vars read through `baseURL`, not hardcoded in specs.

→ [multi-environment-config.md](multi-environment-config.md)

### How do I check accessibility?

`@axe-core/playwright`, driven to the right app state with UI5-aware navigation first - plus a
baseline pattern for an app that already has known debt.

→ [accessibility.md](accessibility.md)

### How do I catch visual regressions?

Screenshot comparison scoped to one stable element rather than the whole page - and be aware
snapshots are platform-sensitive, so they need to be generated where CI runs.

→ [visual-testing.md](visual-testing.md)

### How do I stop a live clock or a timestamp from making a screenshot test flaky?

```ts
import { maskDynamicUi5Content } from 'playwright-sapui5';

const dynamic = await maskDynamicUi5Content(page);
await expect(page).toHaveScreenshot('dashboard.png', { mask: dynamic });
```

Finds every control bound through a real SAPUI5 date/time type - reading the actual binding
metadata, not guessing from what the text currently looks like - so a plain string that merely
resembles a date is correctly left alone.

→ [visual-testing.md](visual-testing.md#masking-dynamic-content)

## Still stuck?

- [troubleshooting.md](troubleshooting.md) - the errors this framework can produce, and what each
  one actually means
- [api-reference.md](api-reference.md) - every exported class, function and type
- [examples.md](examples.md) - a guided tour of the runnable example suite in this repo
- [architecture.md](architecture.md) - how it works internally, if you're extending it
