# Ui5Dialog

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5Dialog` is a small helper for `sap.m.Dialog`, `sap.m.Popover`, `sap.m.MessageBox`, and
anything else built on top of them (`sap.m.ViewSettingsDialog`, `sap.m.SelectDialog`, ...): wait
for one to open, find its buttons by text without accidentally matching a same-labeled button
elsewhere on the page, and wait for it to close again.

See [`examples/tests/dialog.spec.ts`](../examples/tests/dialog.spec.ts) for complete, real,
passing examples, run against the SAPUI5 SDK's own official `ViewSettingsDialog` sample (a
standard sort/filter/group UI pattern, itself built on `sap.m.Dialog`).

## Why dialogs need their own helper

Dialogs have their own timing quirks plain locators don't handle well:

- **They animate open and closed.** A dialog's root element can exist in the DOM (and even be
  briefly "visible" by some definitions) before its open animation has actually finished, or
  still be present for a moment after you've triggered it to close.
- **Their buttons are easy to mismatch.** An "OK" or "Cancel" button inside a dialog is extremely
  likely to share its text with buttons elsewhere in your app - a plain `controlType('sap.m.Button',
{ text: 'OK' })` search isn't scoped to _this_ dialog specifically.

`Ui5Dialog` solves both: it uses SAPUI5's own `isOpen()` method (which every `sap.m.Dialog` and
`sap.m.Popover` implements) as the definitive "is it actually open" signal instead of guessing
from DOM/CSS state, and scopes every button lookup to the one dialog you're holding a reference
to.

## Waiting for a dialog to open

```ts
import { Ui5Dialog } from 'playwright-sapui5';

await page.getByRole('button', { name: 'Sort' }).click(); // trigger whatever opens it
const dialog = await Ui5Dialog.open(page);
```

`Ui5Dialog.open(page, options?)` doesn't trigger anything itself - it only waits for the result of
whatever you triggered separately (a button click, your own app code calling
`sap.m.MessageBox.confirm(...)`, ...). It polls SAPUI5's own control registry for anything
reporting `isOpen() === true`, and wraps whichever one it finds. If your action can plausibly
result in more than one dialog/popover being open simultaneously, `Ui5Dialog.open()` wraps
whichever one the scan happens to return first - for the common case of "I just triggered exactly
one dialog," that ambiguity never comes up.

Throws a clear error if nothing opens within the timeout (default 5000ms):

```
[playwright-sapui5] No open dialog/popover found within 5000ms.
```

## Finding and clicking buttons

```ts
const okButton = await dialog.button('OK');
await okButton.click();

// or, in one call:
await dialog.clickButton('OK');
```

`button(text)` returns a plain Playwright `Locator`, scoped to controls nested inside this
specific dialog's DOM subtree - the same "scoped descendant search" mechanism [`Ui5Table`](ui5-table.md)
uses for rows. A button with the same text somewhere else on the page (in your app's main
content, or in a _different_, already-closed dialog) is never a false match.

## Waiting for it to close

```ts
await dialog.clickButton('Cancel');
await dialog.waitForClose();
```

Polls until the dialog either reports `isOpen() === false`, or has disappeared from the control
registry entirely (some dialogs are destroyed on close, not just hidden - both count as "closed"
here). Call this after clicking whatever closes the dialog, before your test moves on, so the rest
of it doesn't race a still-in-flight closing animation.

## Reading the dialog's title

```ts
const title = await dialog.title();
```

Reads the dialog's own `title` property directly. Some dialogs - `sap.m.ViewSettingsDialog` among
them - build their own custom header out of a separate toolbar/title control instead of using
this property, in which case `title()` comes back as an empty string. If you need the _visible_
header text for a dialog like that, find the header control the same way you'd find any other
control (e.g. `dialog.button(...)`'s scoping pattern, adapted to search for the header's control
type instead).

## What `Ui5Dialog` is not

It isn't chainable or self-healing the way `Ui5Locator` is - a dialog is a single, specific thing
you interact with at one point in a test, not a repeatable lookup strategy you'd want fallback
strategies for. Once you have a `dialog.button(...)` `Locator`, though, it's an ordinary
Playwright `Locator` - use the full Playwright API on it the same as anywhere else in this
framework.
