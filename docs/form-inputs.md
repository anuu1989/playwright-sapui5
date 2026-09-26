# Form input controls (Ui5Select, Ui5DatePicker)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Two SAPUI5 input controls need more than `.click()` and `.fill()`. See
[`examples/tests/form-inputs.spec.ts`](../examples/tests/form-inputs.spec.ts) for complete, real,
passing examples against the SDK's own `Select`, `ComboBox`, `MultiComboBox` and `DatePicker`
samples.

## Ui5Select - dropdowns

Covers `sap.m.Select`, `sap.m.ComboBox`, `sap.m.MultiComboBox`, and the `sap.ui.comp.smartfield`
variants built on them.

### Why a dropdown isn't just "click the option"

**The items you can read are not the items you can click.** A dropdown's options are
`sap.ui.core.Item` objects carrying the `key`s the app binds on - but:

|                                       | `sap.m.Select`                          | `sap.m.ComboBox` / `MultiComboBox`                                      |
| ------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| Options while closed                  | no DOM element                          | no DOM element                                                          |
| Options once open                     | the `Item`s themselves get DOM elements | a **separate** set of `sap.m.StandardListItem`s renders, mirroring them |
| Do the clickable elements carry keys? | yes                                     | **no**                                                                  |

So an ordinary locator can't see the options before opening, can't match them by key after
opening, and would have to know which of two unrelated control types a given dropdown happens to
render. `Ui5Select` handles all three: it reads the real options straight off the control, opens
the dropdown the way a user does (clicking the `<id>-arrow` element SAPUI5 renders, falling back
to the control's own `open()`), and clicks the rendered entry - so the app's `change` /
`selectionChange` handlers fire exactly as they would for a real user.

### Reading the options

```ts
const items = await Ui5Select.items(page, ui5(page).id('countryCombo'));
// → [{ id: '__item0-__box0-0', key: 'DZ', text: 'Algeria' }, ...]
```

Works whether the dropdown is open or shut. Useful for asserting on the available choices, and for
discovering what keys an app actually uses.

### Selecting

```ts
await Ui5Select.selectByText(page, combo, 'Germany');
await Ui5Select.selectByKey(page, combo, 'GER'); // usually the more stable choice
```

`selectByKey` is generally what you want: the key is what the app binds on, so it survives the
label being retranslated or reworded - the same reasoning as [docs/i18n.md](i18n.md). Under the
hood it resolves the key to its option through the control, then clicks that option's rendered
entry, because the rendered entries carry no keys of their own.

`selectByText` matches exactly by default; pass `{ exact: false }` to match any option
_containing_ the text - handy for options that carry a code alongside the label
(`'PR (Projector)'`).

Both throw with the full list of available options/keys when nothing matches, which usually points
straight at the typo.

### Reading the selection

```ts
await Ui5Select.selectedKey(page, select); // single-select
await Ui5Select.selectedKeys(page, multiCombo); // sap.m.MultiComboBox
```

### MultiComboBox

A `MultiComboBox` deliberately keeps its list open after each pick, so selections just stack:

```ts
await Ui5Select.selectByText(page, multi, 'First');
await Ui5Select.selectByText(page, multi, 'Second');
await Ui5Select.close(page, multi);
expect(await Ui5Select.selectedKeys(page, multi)).toEqual(['k1', 'k2']);
```

## Ui5DatePicker - dates

### Why dates flake

Two independent traps, both of which produce failures that only show up on _some_ machines:

1. **Display format varies by locale.** The same day renders as `Apr 14, 2014`, `14.04.2014`,
   `3/15/24` or `2014-04-14` depending on the app's configuration and the user's language. A test
   that types a literal date string only works on the locale it was written against. (The example
   test's app renders `3/15/24` - a format nobody would think to hardcode.)
2. **ISO strings are a timezone trap.** `new Date('2024-03-15')` parses as **UTC midnight**, which
   in any timezone behind UTC is still the 14th locally. Classic off-by-one-day, failing only for
   contributors west of Greenwich, or only in CI.

### setDate

```ts
await Ui5DatePicker.setDate(page, picker, '2024-03-15'); // or: new Date(2024, 2, 15)
```

Takes either a `'YYYY-MM-DD'` string (never parsed as a date, so nothing can shift it) or a `Date`
(read with local getters, so it's the day you'd see on screen). Year/month/day cross into the
browser as plain integers, the value is set through the control's own API, and the control's
`change` event is then fired - so validation, dependent fields and re-filters all run exactly as
they would after a user edit.

Anything that isn't one of those two forms is rejected up front rather than silently producing the
wrong day:

```
[playwright-sapui5] Ui5DatePicker: expected a Date or a 'YYYY-MM-DD' string, got "15/03/2024".
```

### getDate

```ts
const { date, displayValue } = await Ui5DatePicker.getDate(page, picker);
```

`date` is a `Date` built from the control's own calendar parts (no timezone shift); `displayValue`
is the formatted string actually rendered. Assert on `date` and you're locale-proof; assert on
`displayValue` only when the formatting itself is what's under test. `date` is `null` for an empty
field.

### typeDate

```ts
await Ui5DatePicker.typeDate(picker, '15/03/2024');
```

The escape hatch for when the app's _parsing and validation_ of typed input is what's under test -
an invalid date, an unusual format, an expected value-state error. For simply getting a date into
a field, prefer `setDate()`.

## What about checkboxes, switches and radio buttons?

Those need no special helper - they're already covered:

```ts
await ui5(page).id('termsCheckBox').check();
await expect(await ui5(page).id('termsCheckBox').resolve()).toHaveUi5Property('selected', true);
```

`.check()`/`.uncheck()`/`.click()` come from [`Ui5Locator`](locators.md), and
[`toHaveUi5Property`](expect-matchers.md) reads the control's own `selected`/`state` property
rather than guessing from DOM classes.
