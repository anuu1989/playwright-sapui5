# `Ui5MdcTable` (Fiori Elements for OData V4)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5MdcTable` reads a `sap.ui.mdc.Table` - the "metadata-driven controls" (MDC) table that
**Fiori Elements for OData V4** (the flexible programming model, `sap.fe`) renders in a List
Report. This is a genuinely different control family from OData V2's
`sap.ui.comp.smarttable.SmartTable` (see [docs/smart-controls.md](smart-controls.md)) - a `sap.fe`
app needs this class instead, not that one.

```ts
const table = ui5(page).controlType('sap.ui.mdc.Table');

expect(await Ui5MdcTable.rowCount(page, table)).toBeGreaterThan(0);
expect(await Ui5MdcTable.columnHeaders(page, table)).toContain('Status');
```

## Is my app `sap.fe` or the older Fiori Elements?

Check which control type is actually on the page - both patterns look similar in the app shell,
but render completely different controls:

|            | OData V2 ("smart templates")                             | OData V4 (`sap.fe`, flexible programming model) |
| ---------- | -------------------------------------------------------- | ----------------------------------------------- |
| Filter bar | `sap.ui.comp.smartfilterbar.SmartFilterBar`              | `sap.fe.macros.FilterBar`                       |
| Table      | `sap.ui.comp.smarttable.SmartTable`                      | `sap.ui.mdc.Table`                              |
| Helper     | [`Ui5SmartFilterBar`/`Ui5SmartTable`](smart-controls.md) | `Ui5MdcTable` (this page)                       |

## Scope: read-only, deliberately narrow

This reads exactly two things, both verified against a real, live `sap.fe` app:

- **`rowCount()`** - the table's true row count, from `getRowBinding().getLength()`. The same
  "true count vs. rendered count" problem [`Ui5GridTable`](ui5-grid-table.md) and
  [`Ui5SmartTable`](smart-controls.md) solve for their own table families.
- **`columnHeaders()`** - column headers in order, from the table's own `getColumns()`.

**Row/cell text access is not provided.** `sap.ui.mdc.Table` wraps an inner rendering table, the
same way `SmartTable` does - but unlike `SmartTable`'s inner table (reachable through a documented
aggregation), this one's wasn't reliably reachable in testing: a plausible-looking
`<tableId>-innerTable` control exists and is even the right type (`sap.m.Table`), but it doesn't
hold the actually-rendered rows - wrapping it with `Ui5Table` consistently reported zero rows.
Shipping a locator that might silently return the wrong (empty) table would be worse than not
shipping one, so this stops at row count and column headers. If you need a specific cell's text,
scope a plain `ui5()` locator under the table's id yourself.

## Filtering: not an API, drive the real UI

Unlike `Ui5SmartFilterBar.setFilterData()`, there's no bulk filter-setting method here, and that's
a deliberate, tested decision - not a gap. The `sap.fe.macros.FilterBar` control exposes
`setFilterConditions()`/`triggerSearch()`, which look like the obvious equivalent, but **verified
not to work**: calling them with a real, valid condition left the table's row count completely
unchanged. `sap.fe`'s filter-to-table wiring goes through the page's own controller, not something
a raw call to the control's API reliably reaches.

What **is** verified to work, end to end: filling each filter field's real rendered `<input>`
directly, then pressing Enter or clicking the real "Go" button - exactly like driving any other
input:

```ts
const idField = ui5(page).id('fe::FilterBar::Travel::FilterField::TravelID'); // see the note below
const input = (await idField.resolve()).locator('input').first();
await input.fill('1');
await input.press('Enter');
await ui5(page).text('Go', { controlType: 'sap.m.Button' }).click();
```

**Id-suffix matching needs the whole local-id segment.** A filter field's full id looks like
`...::Default--fe::FilterBar::Travel::FilterField::TravelID` - the part after the view's `--`
separator is `fe::FilterBar::Travel::FilterField::TravelID` as one piece (it happens to contain
more `::` inside it), not just the trailing `FilterField::TravelID`. Using only the tail won't
match - see [docs/locators.md](locators.md) for how id-suffix matching works generally, and
[docs/icon-tab-bar.md](icon-tab-bar.md#a-real-gotcha-this-surfaced) for the same lesson learned
against a different `sap.fe` control.

## `Ui5ObjectPage` and `Ui5IconTabBar` already work here

Both were built and verified against OData V2 Fiori Elements, but `sap.uxap.ObjectPageLayout`/
`ObjectPageSection`/`ObjectPageSubSection` are general-purpose SAPUI5 controls, not specific to
either OData version - a `sap.fe` app's Object Page uses the exact same classes, so
[`Ui5ObjectPage`](object-page.md) reads it correctly with no changes needed. Confirmed directly
against this same live `sap.fe` sample.

## API

```ts
Ui5MdcTable.rowCount(target, table): Promise<number | undefined>;
Ui5MdcTable.columnHeaders(target, table): Promise<string[]>;
```

## Verified

Against SAP's own **Flexible Programming Model Explorer**
(`https://ui5.sap.com/test-resources/sap/fe/core/fpmExplorer/`) - a real, live SDK-hosted `sap.fe`
app, not an isolated sample. Its "List Report Page" topic renders inside an iframe (so this also
exercises this framework's existing [cross-frame support](cross-frame.md), unchanged):
`rowCount()` returning the real count (4), `columnHeaders()` returning the real headers (`ID`,
`Status`, ...), and driving the real `TravelID` filter field + "Go" button correctly dropping the
count to 1. See [`examples/tests/mdc-table.spec.ts`](../examples/tests/mdc-table.spec.ts).

Two real "read/act before settled" races surfaced and were fixed during verification, both now
handled by the example test (and worth knowing if you write your own): reading `rowCount()`
immediately after the table control exists in the DOM can race the table's own in-flight OData
request and return `undefined` - wait with `waitForUi5` (or `expect.poll`) first; and this
particular explorer app briefly swaps its iframe out for another shortly after navigating, so a
frame handle grabbed right after `findUi5Frame()` can detach moments later - the example test
retries that step rather than assuming the first frame found is the final one.

## Related

- [docs/smart-controls.md](smart-controls.md) - the OData V2 equivalent
- [docs/object-page.md](object-page.md), [docs/icon-tab-bar.md](icon-tab-bar.md) - already work
  against `sap.fe` apps unmodified
- [docs/cross-frame.md](cross-frame.md) - the iframe support this was verified alongside
