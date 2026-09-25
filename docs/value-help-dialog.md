# Ui5ValueHelpDialog (F4 help)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5ValueHelpDialog` is a helper for value help ("F4 help") dialogs - the picker that opens when
you click the small icon at the end of a value-help-enabled `sap.m.Input`, including one generated
by a `sap.ui.comp.smartfield.SmartField`. See
[`examples/tests/value-help-dialog.spec.ts`](../examples/tests/value-help-dialog.spec.ts) for
complete, real, passing examples, run against two different official SAPUI5 SDK samples - one a
plain `sap.m.Input`, one a Fiori Elements-style `SmartField` - specifically to confirm this helper
works against both of the genuinely different shapes such a dialog can take (see below).

## Why this needs its own helper

Two things make a value help dialog awkward to automate without one:

- **The trigger isn't documented anywhere obvious.** SAPUI5 renders the value-help icon as a
  descendant element of the input with an id ending in `-vhi` - a stable convention this framework
  verified against both a directly-authored `sap.m.Input` and a `SmartField`-generated one - but
  not something you'd find by reading either control's own public API or guess from its properties.
- **The dialog that opens, and its result list's implementation, both vary.** A simple app might
  open a plain `sap.m.Dialog`-based `sap.m.SelectDialog` with a `sap.m.Table` inside; a Fiori
  Elements/SmartField app commonly opens a `sap.ui.comp.valuehelpdialog.ValueHelpDialog` (itself a
  `sap.m.Dialog` subclass) with a `sap.ui.table.Table` - a **virtualized** grid table, see
  [`Ui5GridTable`](ui5-grid-table.md) - inside instead. `selectRow()` checks for both, so you don't
  have to know or care which one a given app happens to use.

## The short version

```ts
import { test, expect } from 'playwright-sapui5';
import { ui5, Ui5ValueHelpDialog } from 'playwright-sapui5';

test('pick a value from the value help dialog', async ({ page }) => {
  await page.goto('https://your-app.example.com/');

  const dialog = await Ui5ValueHelpDialog.openFor(ui5(page).id('idDeliveryTransport'));
  await dialog.selectRow('Bicycle');

  await expect(ui5(page).id('idDeliveryTransport')).toHaveUi5Text('2 (Bicycle)');
});
```

## Opening it

```ts
const dialog = await Ui5ValueHelpDialog.openFor(ui5(page).id('idDeliveryTransport'));
```

`Ui5ValueHelpDialog.openFor(fieldLocator, options?)` resolves `fieldLocator` (which should point
at the input/`SmartField` itself, not the icon), finds its value-help icon by the `-vhi` id
convention described above, clicks it, then waits for the resulting dialog/popover to open and
wraps it - the same "trigger separately, then wait" split
[`Ui5Dialog.open()`](ui5-dialog.md) uses, just with the specific trigger this control needs built
in.

Throws a clear error if the resolved field has no value-help icon at all:

```
[playwright-sapui5] Ui5ValueHelpDialog.openFor: the resolved field has no value-help icon (no descendant element with an id ending in "-vhi"). Is this field's value help actually enabled?
```

## Selecting a value

```ts
await dialog.selectRow('Bicycle');
```

Finds the first result row containing `text` and clicks it - checking a `sap.m.Table`/`sap.m.List`
-based result list first, then falling back to a `sap.ui.table.Table`-based one. In the
**single-select** configuration this framework verified against two real, live apps, clicking a
row both selects _and confirms_ it, closing the dialog with that value applied - no separate "OK"
click needed.

If the dialog you're testing is configured for **multi-select** instead (checkboxes, an explicit
confirm button), `selectRow()` still clicks the row to toggle its checkbox, but you'll need to
confirm the selection yourself afterward:

```ts
await dialog.selectRow('Bicycle');
await dialog.selectRow('Car');
await dialog.clickButton('OK');
```

If the row you want isn't currently rendered - because the result list is a scrollable grid table
and your row is further down than what's rendered by default - `selectRow()` throws, naming both
possibilities it checked. Resolve the row's index yourself and use
[`Ui5GridTable.scrollToRow()`](ui5-grid-table.md) first in that case.

## Buttons and closing

```ts
const okButton = await dialog.button('OK');
await dialog.clickButton('Cancel');
await dialog.cancel(); // convenience for clickButton('Cancel')
await dialog.waitForClose();
```

Same scoped-button-lookup and close-wait behavior as [`Ui5Dialog`](ui5-dialog.md) - a same-labeled
button elsewhere on the page (or in a different, already-closed dialog) is never a false match.
`waitForClose()` is mostly useful after `.clickButton(...)`/`.cancel()`, or in a multi-select
configuration where `.selectRow()` alone doesn't close the dialog - in the single-select case,
`.selectRow()` has usually already closed it by the time it returns.

## Reading the title

```ts
const title = await dialog.title();
```

Same caveat as [`Ui5Dialog.title()`](ui5-dialog.md): some dialogs build their own header out of a
separate control instead of using the `title` property directly, in which case this comes back as
an empty string.

## What this doesn't cover

There's no dedicated helper here for typing into the dialog's own search/filter field before
selecting a row (visible in both this framework's real test samples as a "Search" box with a "Go"
button, sometimes backed by a full [`Ui5SmartFilterBar`](smart-controls.md)) - use the standalone
`ui5(page)` helper to find and fill that field yourself if you need to filter a long result list
down first, the same way you would for any other control. `selectRow()` searches whatever's
currently in the result list, filtered or not.
