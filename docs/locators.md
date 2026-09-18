# Locators

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) first -
> in particular the sections on [optional
> parameters](typescript-for-beginners.md#functions-parameters-optional-parameters-return-types)
> and [union types](typescript-for-beginners.md#union-types-this-or-that), both used heavily below.

This is the full guide to finding and interacting with SAPUI5 controls: every strategy, the
`ui5()` helper, self-healing fallback chains, and the convenience action methods.

## Building a locator

There are two equivalent ways to build a `Ui5Locator`:

```ts
import { ui5 } from 'playwright-sapui5';

// 1. the fluent helper - good for one-off use in a test
await ui5(page).controlType('sap.m.Button', { text: 'Save' }).click();
```

```ts
import { Ui5Page } from 'playwright-sapui5';

// 2. inside a Page Object, via the protected helpers Ui5Page gives you
class MyPage extends Ui5Page {
  get saveButton() {
    return this.controlType('sap.m.Button', { text: 'Save' });
  }
}
```

Both return a `Ui5Locator` - a chainable object with the same methods either way.

## Strategies

### `id(value, options?)`

Matches a control whose id **equals** `value`, or **ends with** `--${value}` (the common
view-scoped id pattern, e.g. `__xmlview0--saveButton` for an id of `saveButton` assigned inside
an XML view). This is the strategy to reach for when the control has an explicit id you (or the
app's developers) assigned - it's the most stable option when available.

```ts
ui5(page).id('saveButton');
ui5(page).id('saveButton', { exact: true }); // require an exact full-id match, no suffix matching
```

### `controlType(type, properties?)`

Matches by full control type name (as it appears in SAPUI5's own API docs, e.g. `sap.m.Button`,
`sap.m.Input`, `sap.m.List`), optionally filtered by property values. Properties are checked by
calling the control's own getter (`text` -> `getText()`, `icon` -> `getIcon()`, etc.), so any
property SAPUI5 exposes a getter for can be used.

```ts
ui5(page).controlType('sap.m.Button', { text: 'Save' });
ui5(page).controlType('sap.m.Button', { icon: 'sap-icon://cart-3' });
ui5(page).controlType('sap.m.List'); // no property filter - matches any control of this type
```

Find a control's type name in the [SAPUI5 API reference](https://ui5.sap.com/) (or in
Chrome/Playwright Inspector, or by running the [Page Object generator](generator.md) against your
app).

### `bindingPath(path, controlType?)`

Matches a control whose OData/JSON model binding context path equals `path` - useful for list
items or forms bound to a specific entity.

```ts
ui5(page).bindingPath('/Products(1)');
ui5(page).bindingPath('/Products(1)', 'sap.m.ObjectListItem');
```

### `text(value, options?)`

Matches by visible text - checked against whichever of `getText()`, `getTitle()`, `getValue()`,
`getLabel()`, or `getHeaderText()` the control exposes.

```ts
ui5(page).text('Save');
ui5(page).text('Save', { controlType: 'sap.m.Button' }); // narrow to a control type too
ui5(page).text('Save', { exact: true }); // exact match instead of "contains"
```

### `css(selector)`

Escape hatch: a plain CSS selector, resolved with regular Playwright semantics. Still benefits
from the framework's auto-wait and self-healing - useful when you need to reach something that
isn't a SAPUI5 control (plain HTML you control) or that the other strategies can't express.

```ts
ui5(page).css('[data-testid="custom-widget"]');
```

### `role(role, name?)`

Escape hatch: matches by ARIA role, via Playwright's own `page.getByRole()` under the hood.

```ts
ui5(page).role('button', 'Save');
```

## Self-healing: fallback strategies

Chain `.fallback(...)` to add alternate strategies, tried in order if earlier ones don't match
within their share of the timeout budget:

```ts
await ui5(page)
  .controlType('sap.m.Button', { text: 'Save' })
  .fallback({ by: 'id', value: 'saveButton' })
  .fallback({ by: 'css', selector: '.myApp-saveBtn' })
  .as('Save button')
  .click();
```

If the primary strategy (`controlType` + text) doesn't match in time, the framework tries the
`id` fallback, then the `css` fallback, in order. As soon as one matches, it's used - and if it
wasn't the first one, a warning is logged:

```
[playwright-sapui5] Self-healed locator "Save button" using fallback #2: {"by":"id","value":"saveButton"}
```

`.as('label')` names the locator for this message (and for the error thrown if every strategy
fails) - always add one when you use fallbacks, so you know which locator needed healing.

**Why this matters:** a UI change that renames a button's text, or a refactor that changes a
control's id, doesn't have to break your test immediately - it degrades to a logged warning
instead, giving you a heads-up to fix the primary strategy on your own schedule rather than a
failing CI run blocking someone else's unrelated PR.

To observe heals programmatically (e.g. to fail CI on _any_ heal, or to feed a dashboard), use
`SelfHealingResolver.onHeal(listener)`:

```ts
import { SelfHealingResolver } from 'playwright-sapui5';

SelfHealingResolver.onHeal((event) => {
  console.log(`Healed "${event.label}" via strategy #${event.attempt}`, event.strategy);
});
```

## Timeout budget

Every locator resolution has a total timeout (15000ms for the convenience action methods, unless
overridden), split evenly across however many strategies you've chained. Three strategies with a
15000ms budget get 5000ms each. Override per-call:

```ts
await ui5(page).id('slowThing').click({ timeout: 30000 });
```

## Action methods

Once you have a `Ui5Locator`, these methods resolve it (auto-waiting for the app to settle first,
unless you opt out) and act:

```ts
await locator.click(options?);
await locator.fill(value, options?);
await locator.check(options?);
await locator.uncheck(options?);
await locator.hover(options?);
const text = await locator.getText(options?);
const visible = await locator.isVisible(options?);
const enabled = await locator.isEnabled(options?);
const n = await locator.count(options?);
await locator.waitFor(options?);
```

Each accepts `{ timeout?, autoWaitUi5? }` plus whatever options the corresponding Playwright
`Locator` method accepts (e.g. `force`, `modifiers` for `click`). Set `autoWaitUi5: false` to skip
the busy-state wait for that call - useful for local-only interactions (like toggling a
checkbox that doesn't trigger a request) where you want to shave latency off a large suite.

## Dropping down to plain Playwright

`.resolve()` returns a real Playwright `Locator`, so anything the convenience methods don't cover
(drag-and-drop, screenshots, `expect(...)` assertions, etc.) is one call away:

```ts
const button = await ui5(page).controlType('sap.m.Button', { text: 'Save' }).resolve();
await expect(button).toBeEnabled();
await button.dragTo(otherLocator);
```

## Everything is chainable and reusable

A `Ui5Locator` is cheap to build and re-resolves fresh each time you call an action or
`.resolve()` - so store one in a Page Object getter and call it as many times as you like across
a test; you don't need to "re-find" it manually between actions.
