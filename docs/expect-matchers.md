# Custom UI5 expect matchers

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

This framework's `expect` (the one you get from `import { expect } from 'playwright-sapui5'`) has
three extra assertions built in, on top of everything Playwright's own `expect` already gives
you: `toHaveUi5Property`, `toHaveUi5Text`, and `toBeUi5Busy`. All three read a control's **own
live property values**, through the bridge, instead of inspecting whatever ended up rendered in
the DOM - see [docs/architecture.md](architecture.md#the-browser-bridge-in-detail) for how the
bridge itself works.

See [`examples/tests/matchers.spec.ts`](../examples/tests/matchers.spec.ts) for complete, real,
passing examples of everything on this page.

## Why assert on a property instead of on text?

Playwright's own `expect(locator).toHaveText(...)` checks the DOM's rendered text content - which
is usually exactly what you want. But a control's _property_ and its _rendered text_ aren't
always the same thing:

- A `sap.m.Input`'s bound `value` can differ from what's visually shown if the control applies
  formatting (a currency symbol, date formatting, a mask) - asserting on the raw property lets you
  check the underlying data your app is actually working with, separately from its presentation.
- Boolean state (`enabled`, `editable`, `busy`, `visible`) has no "text" at all to assert on with
  a text-based matcher - you'd otherwise have to infer it indirectly (a disabled-looking CSS
  class, a missing attribute).
- Reading a property is exactly what a real user of your app _can't_ directly observe, but what
  your application logic actually depends on - useful when you specifically want to test the data
  layer's correctness, not just what's visible.

Use whichever is a better fit for what you're actually trying to prove: rendered text for "what
does the user see," a UI5 property for "what does the control's underlying state say."

## `toHaveUi5Property(name, expected, options?)`

Asserts a control's property equals `expected`, comparing with `===`. Works well for primitives
(strings, numbers, booleans - covers the large majority of real property assertions); it does
**not** deep-compare arrays or objects.

```ts
import { expect } from 'playwright-sapui5';

await expect(cart.categoryList).toHaveUi5Property('headerText', 'Categories');
await expect(myInput).toHaveUi5Property('enabled', false);
```

`name` is the property name as SAPUI5 itself names it (`text`, `value`, `enabled`, `busy`, ...) -
the same name you'd see in that control's API documentation, **not** prefixed with `get`. The
matcher builds the getter name (`get` + capitalized property name) for you internally.

## `toHaveUi5Text(expected, options?)`

A convenience shortcut for the single most common case: "what text does this show," without you
having to know which specific property holds it. Tries the same candidate getters
`Ui5Locator.text(...)` itself searches by - `text`, `title`, `value`, `label`, `headerText` -
and matches against whichever one the control actually has.

```ts
await expect(cart.category('Laptops')).toHaveUi5Text('Laptops');
```

Equivalent in spirit to `toHaveUi5Property('text', ...)`, except you don't have to guess whether
this particular control calls it `text`, `title`, or something else.

## `toBeUi5Busy(options?)`

Asserts a control's own `busy` property is `true`. This is a **narrower, more targeted** check
than the framework's own auto-wait (`waitForUi5`/`Ui5Bridge.isBusy()`), which asks "is _anything
on the whole page_ busy?" Use `toBeUi5Busy` when you specifically want to know that _one
particular_ control - a panel, a table, a section - is showing its own busy state, independent of
the rest of the page:

```ts
await expect(myPanel).toBeUi5Busy(); // this panel specifically is loading
await expect(myPanel).not.toBeUi5Busy(); // ...and now it's done
```

## Every matcher accepts a `Ui5Locator` _or_ a plain Playwright `Locator`

All three matchers work with either:

```ts
await expect(cart.categoryList).toHaveUi5Text('Categories'); // a Ui5Locator
await expect(await cart.categoryList.resolve()).toHaveUi5Text('Categories'); // an already-resolved Locator
```

Internally, a `Ui5Locator` is resolved (with its usual self-healing/auto-wait behavior) before
being read; a plain `Locator` is used as-is. Either way, the matcher then reads the exact DOM id
the locator resolved to and looks up the matching SAPUI5 control by that id.

## Auto-waiting and `.not`

Like Playwright's own built-in assertions, these matchers retry for a while (default 5000ms,
override with `{ timeout }`) before failing - so `await expect(x).toHaveUi5Property('busy',
false)` correctly waits out a control that's still finishing up, rather than checking once and
giving up immediately. `.not` is fully supported and resolves quickly for the common "prove
something settled" case, rather than always waiting out the full timeout regardless of which way
the assertion was written.

## Failure messages

Every matcher distinguishes between the specific reasons an assertion could fail, rather than a
generic "assertion failed":

```
Expected a control with property "headerText" = "Not The Real Header", but the locator never resolved to a control.
The resolved control has no "notAProperty" property (no getNotAProperty() method).
Expected property "headerText" to be "Not The Real Header", but it was "Categories".
```

## Using these matchers with plain `@playwright/test`

These matchers are only available on the `expect` this package exports - if you import `expect`
directly from `@playwright/test` instead, you won't have `toHaveUi5Property`/`toHaveUi5Text`/`toBeUi5Busy`
(and TypeScript will correctly refuse to compile a call to one, since only this package's `expect`
carries the type augmentation that declares them). Import `{ expect }` from `'playwright-sapui5'`
to get them.
