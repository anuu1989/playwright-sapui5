# Ui5GridTable (sap.ui.table.Table)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5GridTable` is a dedicated helper for `sap.ui.table.Table` - the separate "grid" table control
(also the base for `sap.ui.table.TreeTable`), distinct from `sap.m.Table`/`sap.m.List`, which
[`Ui5Table`](ui5-table.md) already covers. If `Ui5Table.from(...)` throws or behaves oddly against
a table you're targeting, check what control type it actually is first - the two controls need
genuinely different handling, described below, and are not interchangeable.

See [`examples/tests/grid-table.spec.ts`](../examples/tests/grid-table.spec.ts) for complete,
real, passing examples, run against the SAPUI5 SDK's own official sample - a real grid table with
123 rows of product data.

## Why this control needs its own helper

`sap.ui.table.Table` **virtualizes** its rows: rather than rendering one DOM row per data row (the
way `sap.m.Table` does), it keeps a small, fixed pool of `<tr>` elements - sized by how many rows
fit on screen - and re-binds that same pool to different data rows as you scroll. A table with 500
rows of data might only ever have 10 rows' worth of actual DOM elements in existence at once.

That breaks `Ui5Table`'s whole approach, which is to search the DOM for every currently-rendered
row of a given control type. For a grid table, "currently rendered" might only ever be a tiny
fraction of the real result set - so `Ui5GridTable.row(index)`/`.cellText(...)` below only ever see
whatever's in that pool _right now_, and `.scrollToRow(index)` is how you deliberately bring a
specific data row into it before acting on it - via the control's own `setFirstVisibleRow()`
method (the same API SAPUI5 itself uses for programmatic scrolling), not by simulating mouse
wheel/scrollbar events against a control that manages its own rendering.

`.rowCount()` is the one thing here that's _not_ affected by any of this: it reads the table's own
data binding length directly, so it's always the true total, never limited by what's rendered.

## The short version

```ts
import { test, expect } from 'playwright-sapui5';
import { ui5, Ui5GridTable } from 'playwright-sapui5';

test('grid table basics', async ({ page }) => {
  await page.goto('https://your-app.example.com/');

  const tableLocator = ui5(page).controlType('sap.ui.table.Table');
  await tableLocator.waitFor(); // see the timing gotcha below
  const table = await Ui5GridTable.from(tableLocator);

  expect(await table.rowCount()).toBeGreaterThan(0);
  expect(await table.cellText(0, 0)).toBeTruthy(); // row 0 is rendered by default

  await table.scrollToRow(50); // bring row 50 into the rendered window
  expect(await table.cellText(50, 0)).toBeTruthy();
});
```

## Wrapping a table

```ts
const table = await Ui5GridTable.from(ui5(page).controlType('sap.ui.table.Table'));
```

`Ui5GridTable.from(tableLocator, options?)` resolves `tableLocator` once (the same self-healing/
auto-wait behavior as any other `Ui5Locator` resolution) to find the container's exact DOM id.

### A timing gotcha worth knowing

`.from()` only waits for the table's own root element to exist - it does **not** wait for the
table's internal row pool to be built, which happens slightly after that, as part of the table's
own rendering cycle. Calling `Ui5GridTable.from(...)` and then immediately `.row(0)`/`.cellText(...)`
right after `page.goto()`, with nothing in between, can occasionally race that - `renderedRowCount()`
comes back `0` for a moment even though the table (and its data) genuinely exist. If you see an
intermittent `"the table has no rendered rows right now"` error immediately after navigation,
`.waitFor()` the locator first (this framework's normal auto-wait, which waits for the app to
settle) before building the `Ui5GridTable`:

```ts
const tableLocator = ui5(page).controlType('sap.ui.table.Table');
await tableLocator.waitFor();
const table = await Ui5GridTable.from(tableLocator);
```

## Row count

```ts
const count = await table.rowCount();
```

The **true** total, read from the table's own data binding (`getBinding('rows').getLength()`) -
not however many rows happen to be rendered right now. `undefined` if the table hasn't bound any
data yet.

## Reading a row or cell

```ts
const cellText = await table.cellText(rowIndex, columnIndex); // 0-based row and column
const row = await table.row(rowIndex); // a plain Playwright Locator
```

Both only work if `rowIndex` is **currently rendered**. Calling either for a row outside the
table's current window throws a clear, actionable error rather than Playwright's generic "resolved
to 0 elements":

```
[playwright-sapui5] Ui5GridTable row 50 is not currently rendered (rows 0-9 are, out of 123 total). Call .scrollToRow(50) first.
```

Check `renderedRowCount()`/`firstVisibleRow()` if you need to know the current window
programmatically, or just call `scrollToRow(rowIndex)` first if you're not sure:

```ts
await table.scrollToRow(50);
const cellText = await table.cellText(50, 0); // now works
```

## Finding a row by its content

```ts
const row = await table.rowContaining('Smart Multimedia');
```

Same idea as [`Ui5Table.rowContaining`](ui5-table.md), but only searches **currently rendered**
rows - `scrollToRow()` through the data first if the row you're looking for might be further down
than what's rendered by default.

## Column headers

```ts
const headers = await table.columnHeaders(); // e.g. ['Product Name', 'Product Id', 'Quantity', ...]
```

Reads the table's own `columns` aggregation (each a `sap.ui.table.Column`) and each column's
`label` aggregation - note this is `label` (singular), not the `header` aggregation
`sap.m.Table`'s columns use, since `sap.ui.table.Column` is a different control with its own
aggregation names.

## Where this shows up in practice

Two real, verified places a grid table appears without you necessarily choosing it:

- **[`Ui5SmartTable`](smart-controls.md)** - a Fiori Elements SmartTable decides at runtime
  whether to build a `sap.m.Table` or a `sap.ui.table.Table`. Check `innerTableType()`, and hand
  `innerTableLocator()` to `Ui5GridTable.from(...)` when it comes back `'sap.ui.table.Table'`.
- **A `sap.ui.comp.valuehelpdialog.ValueHelpDialog`'s** result list is commonly a
  `sap.ui.table.Table` too (verified against the SDK's own SmartField-with-ValueHelp sample) - see
  [`Ui5ValueHelpDialog`](value-help-dialog.md), which already handles this for you.
