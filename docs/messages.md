# Toasts and messages

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Two different SAPUI5 mechanisms, two helpers:

- **`Ui5MessageToast`** - the transient "Product added to your cart" popups.
- **`Ui5Messages`** - SAPUI5's central **message model**, where validation errors, OData backend
  errors and app-raised messages collect.

See [`examples/tests/messages.spec.ts`](../examples/tests/messages.spec.ts) for complete, real,
passing examples.

## Ui5MessageToast

### The problem it solves

A `sap.m.MessageToast` is the most awkward thing in SAPUI5 to assert on, for three compounding
reasons:

1. **It isn't a control.** Nothing in the element registry, no id, no `isOpen()` - so none of this
   framework's locators can find it, and neither can OPA5's usual matchers.
2. **It renders as a bare `<div class="sapMMessageToast">`** appended to the body.
3. **It removes itself after about three seconds.**

Point 3 is the real killer. A test that clicks a button and then looks for the toast is racing
that timer, and loses exactly when the machine is slow - which is exactly when CI is slow. That's
the classic "passes on my laptop, flakes in the pipeline" failure.

### How this helper avoids the race

It doesn't look at the DOM at all. When the bridge installs, it wraps `MessageToast.show()`, so
every toast the app raises is **recorded as it happens** and stays readable long after the toast
itself is gone. There's no timer left to race:

```ts
await Ui5MessageToast.clear(page); // ignore anything from earlier in the test
await addToCartButton.click();
await Ui5MessageToast.waitForText(page, /added to your shopping cart/i);
```

Because toasts are recorded rather than observed, `waitForText` matches one raised _before_ the
call just as happily as one raised during it - so it's safe to call it well after the action, with
no risk of having "missed" it. The example test proves this directly: it waits for the toast to
disappear from the DOM entirely, then still asserts on it.

### API

```ts
await Ui5MessageToast.all(page); // [{ text, at }, ...] - oldest first
await Ui5MessageToast.texts(page); // ['Product ... added', ...]
await Ui5MessageToast.clear(page); // reset before the action under test
await Ui5MessageToast.waitForText(page, 'added', { timeout: 5000 });
```

`waitForText` takes a substring or a `RegExp`, and on timeout lists every toast it _did_ record -
usually enough to spot a wording mismatch immediately.

### Combining with i18n

The app raises toasts with translated strings, so assert on the key, not on one language's
rendering of it (see [docs/i18n.md](i18n.md)):

```ts
const expected = await Ui5I18n.getText(page, 'avatarButtonMessageToastText');
await loginButton.click();
await Ui5MessageToast.waitForText(page, expected);
```

### Limitation

Toasts raised before the bridge finished installing (i.e. during the very first moments of app
startup) aren't recorded - the wrap can only happen once `sap.m` itself has loaded. In practice
this only affects toasts fired during bootstrap, which is rare.

## Ui5Messages

SAPUI5 collects validation errors, OData backend errors and app-raised messages into one central
message model - the thing a Fiori app's message popover renders from.

```ts
await saveButton.click();
expect(await Ui5Messages.errors(page)).toEqual([]); // nothing went wrong
```

This is the reliable way to assert "the form reported exactly this error". Hunting for whichever
control happens to render it is brittle twice over: the message might surface in a value-state
tooltip, a message strip, a popover behind a footer button, or a dialog, depending on how the app
was built - and an **OData error might not be rendered anywhere at all** while still being the
reason your test's next step mysteriously fails.

### API

```ts
await Ui5Messages.all(page); // every message
await Ui5Messages.errors(page); // type === 'Error'
await Ui5Messages.warnings(page); // type === 'Warning'
await Ui5Messages.waitForMessage(page, /mandatory/i, { type: 'Error' });
await Ui5Messages.clear(page); // reset between steps
```

Each message is `{ type, message, description, target }`, where `type` is SAPUI5's `MessageType`
(`'Error'`, `'Warning'`, `'Success'`, `'Information'`, `'None'`). Works with both the modern
`sap/ui/core/Messaging` module and the older `Core.getMessageManager()`, so it covers old and new
UI5 versions alike.

Unlike toasts, messages aren't transient - they stay until something clears them - so
`waitForMessage` is a straightforward wait with no race to worry about.

## What about MessageBox?

`sap.m.MessageBox` builds a real `sap.m.Dialog` underneath, so it's already covered by
[`Ui5Dialog`](ui5-dialog.md):

```ts
const box = await Ui5Dialog.open(page);
await box.clickButton('OK');
await box.waitForClose();
```
