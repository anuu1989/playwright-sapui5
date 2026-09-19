# Ui5Table

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5Table` is a higher-level API for `sap.m.Table` and `sap.m.List`: row access by index or
content, cell text, row count, and column headers - the single most common thing to hand-roll
yourself in a real Fiori test suite, since a table/list's rows aren't things you can address with
a fixed locator the way a button is.

See [`examples/tests/table.spec.ts`](../examples/tests/table.spec.ts) for complete, real, passing
examples, run against the SAPUI5 SDK's own official `sap.m.Table` sample.

## Wrapping a table

```ts
import { ui5, Ui5Table } from 'playwright-sapui5';

const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));
```

`Ui5Table.from(locator, options?)` takes any `Ui5Locator` that resolves to a table/list control,
resolves it once (with the usual self-healing/auto-wait behavior), and figures out what its rows
are:

- If you pass `{ rowControlType: 'sap.m.ColumnListItem' }` explicitly, that's what it uses.
- Otherwise, it auto-detects by trying `sap.m.ColumnListItem` (what `sap.m.Table` uses),
  then `sap.m.ObjectListItem`, `sap.m.StandardListItem`, and `sap.m.CustomListItem` (the row
  types `sap.m.List` commonly uses), in that order, and uses whichever one actually has rendered
  rows.

## Rows

```ts
const count = await table.rowCount(); // how many rows are currently rendered
const first = await table.row(0); // Locator for row 0
const withText = await table.rowContaining('Titanium'); // Locator for the first row containing this text
```

`row(index)` throws a clear error (`Ui5Table row index N is out of range (table has M rendered
rows)`) instead of resolving to an empty, unusable `Locator` the way Playwright's own `.nth()`
would for an out-of-range index.

**"Currently rendered" matters.** A `growing`-enabled table only renders a subset of its bound
data at a time - `rowCount()`/`row()`/`rowContaining()` only see what's actually on screen right
now, the same "only what's real and visible" philosophy the rest of this framework follows (see
[docs/core-concepts.md](core-concepts.md#why-controls-without-a-dom-presence-dont-show-up)). If
you need a row that's further down than what's currently rendered, scroll (or increase the
growing threshold) first.

## Cells - `sap.m.Table` only

```ts
const supplier = await table.cellText(0, 1); // row 0, column 1
```

This relies on a specific, verified SAPUI5 rendering convention: each cell of a
`sap.m.ColumnListItem` (a `sap.m.Table` row) renders as `<td id="<rowId>-cell<N>">`, wrapping
whatever control that column actually holds (a `Text`, an `ObjectIdentifier`, an `ObjectNumber`,
...). Reading that wrapper's own rendered text works regardless of which specific control type is
inside it - you don't need to know or care what each column's cell template control is.

**This does not apply to `sap.m.List`.** `StandardListItem`/`ObjectListItem`/`CustomListItem`
rows have no equivalent per-cell DOM structure - there's no tabular "column" concept for a plain
list, only the row's own text/description/icon. Calling `cellText` on a `Ui5Table` wrapping a
`sap.m.List` won't find anything meaningful.

## Column headers - `sap.m.Table` only

```ts
const headers = await table.columnHeaders(); // e.g. ['Product', 'Supplier', 'Dimensions', 'Weight', 'Price']
```

Reads the table's own `columns` aggregation and, for each column, its `header` control's visible
text. Also `sap.m.Table`-specific - `sap.m.List` has no `columns` aggregation to read.

## What this doesn't cover: `sap.ui.table.Table`

SAPUI5 has a _second_, separate table control - `sap.ui.table.Table` (the desktop "grid" table,
distinct from `sap.m.Table`'s "responsive" table). It's built very differently: rows are
virtualized and recycled as you scroll, rather than being a straightforward list of items the way
`sap.m.Table`/`sap.m.List` are - the DOM elements for "row 5" can be reused to render what's
logically "row 50" a moment later, and cell access works through a completely different internal
structure. `Ui5Table` does not support it. If your app uses `sap.ui.table.Table` and you need
this kind of helper for it, [`src/core/Ui5Table.ts`](../src/core/Ui5Table.ts) is a reasonably
short, readable starting point to adapt - but expect the row-virtualization behavior to need
different handling than what's here.

## Under the hood

`Ui5Table` is built on two of the same bridge primitives that back a couple of other advanced
features (`Ui5Dialog`'s scoped button search, in particular):

- `findDescendantControlsByType(containerId, type)` - every currently-rendered control of a given
  type, nested anywhere inside one specific container's DOM subtree. This is what scopes
  `row()`/`rowContaining()` to _this table's own_ rows, so a same-shaped row in some other table
  elsewhere on the page is never a false match.
- `getAggregation(containerId, aggregationName)` - reads one of a control's own SAPUI5
  "aggregations" (a property that holds other controls) directly, used for `columnHeaders()`.

See [docs/architecture.md](architecture.md) for the full picture of how the bridge works.
