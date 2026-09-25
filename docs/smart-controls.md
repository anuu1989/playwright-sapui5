# SmartFilterBar and SmartTable (Fiori Elements)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`sap.ui.comp.smartfilterbar.SmartFilterBar` and `sap.ui.comp.smarttable.SmartTable` are the pair
of controls behind most Fiori Elements list reports: a filter bar and a result table that SAPUI5
**generates at runtime** from your service's OData metadata and annotations, rather than
something you build by hand. That's exactly what makes them hard to automate with plain locators:

- A SmartFilterBar's fields aren't fixed - one filterable property becomes an `sap.m.Input`,
  another a `DatePicker`, another a `MultiInput` with removable tokens, another a `ComboBox` or
  `Switch`, depending entirely on that property's type and annotations. A test that clicks into
  each field individually has to know, and keep up to date with, exactly which widget every
  property currently uses.
- A SmartTable doesn't commit to one table implementation either - it builds a plain `sap.m.Table`
  **or** the separate, virtualized `sap.ui.table.Table` "grid" control, again decided at runtime.
  The grid table variant only ever renders a small window of its bound rows in the DOM, so
  anything that counts rendered `<tr>`s badly undercounts a real result set.

`Ui5SmartFilterBar` and `Ui5SmartTable` sidestep both problems by going through the controls' own
SAPUI5 APIs (`setFilterData`/`getFilterData`/`search`, and reading the inner table's own data
binding) instead of interacting with whatever individual field/row controls happen to exist right
now. See [`examples/tests/smart-controls.spec.ts`](../examples/tests/smart-controls.spec.ts) for a
complete, real, passing example, run against the SAPUI5 SDK's own official sample (which - unlike
most SDK samples - has real, if small, mock OData data behind it, so a search genuinely returns
different rows for different filter values).

## The short version

```ts
import { test, expect } from 'playwright-sapui5';
import { ui5, Ui5SmartFilterBar, Ui5SmartTable } from 'playwright-sapui5';

test('search and read results', async ({ page }) => {
  await page.goto('https://your-app.example.com/');

  const filterBar = await Ui5SmartFilterBar.from(
    ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),
  );
  const smartTable = await Ui5SmartTable.from(
    ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),
  );

  await filterBar.setFilterData({ CompanyCode: '0001' });
  await filterBar.search();

  expect(await smartTable.rowCount()).toBeGreaterThan(0);
});
```

## `Ui5SmartFilterBar`

### Wrapping it

```ts
const filterBar = await Ui5SmartFilterBar.from(
  ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),
);
```

`Ui5SmartFilterBar.from(filterBarLocator, options?)` resolves `filterBarLocator` once (the same
self-healing/auto-wait behavior as any other `Ui5Locator` resolution) to find the control's exact
DOM id. There's usually only one SmartFilterBar on a given page, so `controlType(...)` with no
further filter is normally enough; add `{ id: '...' }`/`.fallback(...)` to the locator the same
way you would anywhere else in this framework if you ever need to be more specific.

### Reading and setting filter values

```ts
const data = await filterBar.getFilterData();
await filterBar.setFilterData({ CompanyCode: '0001' });
```

Both go through the control's own `getFilterData()`/`setFilterData(data)` methods - the same API
SAPUI5 itself uses internally to persist and restore filter state (e.g. via variant management).
`data`'s keys are OData property names, not field labels or control ids.

#### `setFilterData` needs the right shape per field

For a **simple** field (a plain text/number/date value, one `sap.m.Input`/`DatePicker`), a bare
value works:

```ts
await filterBar.setFilterData({ CompanyCode: '0001' });
```

For a **token-based** field (rendered as a `MultiInput` with removable tokens - common for
`Edm.String` properties with a value list, like `CompanyCode` in the example above),
`setFilterData` needs the _whole_ shape `getFilterData()` itself returns for that property:

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

Passing a bare string for a token-based field (`setFilterData({ CompanyCode: '9999' })`) doesn't
throw, and `getFilterData()` will even show it back to you afterward - but it only updates that
field's top-level `.value`, not the `.ranges` array `search()` actually filters by, so the search
results silently don't change. If a `setFilterData` call doesn't seem to affect the results, this
is the first thing to check: call `getFilterData()` first, inspect the shape it already uses for
the field you're changing, and mirror that shape back.

### Searching

```ts
await filterBar.search();
```

Calls the control's own `search()` method - equivalent to clicking its "Go" button, without
needing to find that button (its visible label is localized, and its id is auto-generated like
everything else on this control). Since a search always fires an async OData request, `search()`
then waits for the app to settle (the same `waitForUi5` auto-wait every other action in this
framework uses) before returning - best-effort, so a slow backend won't fail the call outright,
matching how `Ui5Locator`'s own actions behave.

## `Ui5SmartTable`

### Wrapping it

```ts
const smartTable = await Ui5SmartTable.from(
  ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),
);
```

Same pattern as `Ui5SmartFilterBar.from` above.

### Row count

```ts
const count = await smartTable.rowCount();
```

Reads the **true** row count from the inner table's own data binding
(`getBinding('rows').getLength()` for a grid table, `getBinding('items').getLength()` for a
response table) - not however many rows happen to be rendered in the DOM right now.

#### Why `rowCount()` does not count DOM rows

`sap.ui.table.Table` (the grid table variant) only ever renders a small, scroll-following "window"
of its bound rows into the DOM - typically far fewer than the real result count - to stay fast
with large data sets. Counting rendered rows the way [`Ui5Table`](ui5-table.md) does for a plain
`sap.m.Table` would badly undercount a grid-table-backed SmartTable's actual results. Reading the
binding's own length sidesteps that entirely, and works the same way regardless of which inner
table type the SmartTable happened to build.

`rowCount()` returns `undefined` if the SmartTable hasn't built its inner table yet, or that
table's binding hasn't loaded data yet - call it after `filterBar.search()` (or your own
equivalent trigger), not immediately after navigation.

### Which table did it build?

```ts
const type = await smartTable.innerTableType(); // 'sap.m.Table' | 'sap.ui.table.Table' | null
```

Useful to decide how to interact with the results further.

### Getting at the inner table directly

```ts
const inner = await smartTable.innerTableLocator(); // a Ui5Locator
```

The escape hatch for anything `Ui5SmartTable` doesn't cover itself. Hand it to
`Ui5Table.from(inner)` when `innerTableType()` is `'sap.m.Table'` for row/cell/header access - see
[docs/ui5-table.md](ui5-table.md) - or to `Ui5GridTable.from(inner)` when it's
`'sap.ui.table.Table'` - see [docs/ui5-grid-table.md](ui5-grid-table.md). Either way, be aware
that a `'sap.ui.table.Table'` deliberately renders its own root element with `height: 0` (its
actual visible content lives in a nested child element), so
`expect(await inner.resolve()).toBeVisible()` on the _root_ itself will report `false` even while
the table is genuinely showing rows on screen - prefer `rowCount()`/`innerTableType()` above, or
`Ui5GridTable`'s own methods, for assertions instead.
