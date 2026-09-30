# `Ui5MultiInput`

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5MultiInput` adds, reads, and removes tokens on `sap.m.MultiInput` (and the same-shaped
`sap.m.MultiComboBox`) - the "type to search, pick a suggestion, get a removable chip" fields used
for recipient lists, multi-value filters, and the like.

```ts
const field = ui5(page).id('recipientsInput');
await Ui5MultiInput.addByText(page, field, 'Astro Laptop 1516');

expect(await Ui5MultiInput.tokens(page, field)).toContainEqual(
  expect.objectContaining({ key: 'HT-1251', text: 'Astro Laptop 1516' }),
);

await Ui5MultiInput.removeByText(page, field, 'Astro Laptop 1516');
```

## Why this needs a helper at all

A token's `key` - the value the app actually binds and filters on - is real bound data with **no
DOM representation at all**. Verified against a real `sap.m.MultiInput` SDK sample: only the
rendered chip's _text_ ever reaches the DOM; the key only comes back from `sap.m.Token#getKey()`,
straight off the control - the same reason `Ui5Select` exists for a dropdown's items.

Adding a token also isn't a single action - it's a small real flow: type into the field, wait for
SAPUI5's own suggestion popup (rendered at `<id>-popup`), then click the matching row. Calling the
control's `addToken()` directly would skip that flow entirely, along with whatever the app's own
`suggestionItemSelected`/`tokenUpdate` handlers do in response to it - so `Ui5MultiInput.addByText`
drives the real thing instead: `fill()` into the field's own `<input>`, wait for the popup, click
the row whose text matches.

## API

```ts
Ui5MultiInput.tokens(target, multiInput): Promise<Ui5TokenInfo[]>;
Ui5MultiInput.addByText(target, multiInput, text, options?): Promise<void>; // { exact?: boolean; timeout?: number }
Ui5MultiInput.removeByText(target, multiInput, text): Promise<void>;
Ui5MultiInput.removeAll(target, multiInput): Promise<void>;
```

```ts
interface Ui5TokenInfo {
  id: string;
  key: string | undefined;
  text: string | undefined;
}
```

`addByText` matches the suggestion row's text exactly by default; pass `{ exact: false }` for a
row that carries more than just the label (a code alongside the name, say). It throws if no
matching suggestion appears within `timeout` (default 5000ms).

`removeByText` and `removeAll` both remove a token by clicking its own delete icon - rendered at
`<tokenId>-icon`, SAPUI5's own convention for a token's close button (verified against a real
control) - a real click, so the app's own `tokenUpdate` handler fires the same as it would for a
user clicking it.

`addByText` doesn't return the moment the suggestion row is clicked - it polls the control's own
token count until it actually increases (see the next section for why that matters).

## Two real gotchas this surfaced

- **Clicking a suggestion doesn't commit the token synchronously.** Confirmed by a genuine CI-style
  flake during verification: reading `tokens()` immediately after clicking a suggestion row - the
  token was already visible in the DOM's own Tokenizer at that point - sometimes still returned an
  empty array, because `sap.m.MultiInput#getTokens()` (the control's own aggregation, not the DOM)
  hadn't been updated yet. `addByText` now polls the control's own count until it moves before
  returning, rather than trusting the click alone - the same "the DOM changing isn't the same
  moment as the control's own state changing" trap `Ui5Wizard`'s `getCurrentStep()` unwrapping and
  `Ui5MdcTable`'s row-count reads both work around too.
- **The SDK's own `sap.m.MultiInput` sample renders three `MultiInput` fields on one page** (only
  the first has real suggestion data), so `ui5(page).controlType('sap.m.MultiInput')` matches all
  of them - scope to the field's own known id instead, `ui5(page).id('multiInput')`, the same
  "disambiguate by known id, not just type" fix
  [docs/icon-tab-bar.md](icon-tab-bar.md#a-real-gotcha-this-surfaced) uses for a page that happens
  to render more than one control of the same type.

## Verified

Against the SAPUI5 SDK's own official `sap.m.MultiInput` sample: typing `'a'` into the field opens
a real suggestion popup with a matching product; `addByText('Astro Laptop 1516')` clicks it and
produces a token whose `key` reads back as `'HT-1251'` - the app's real product id, never
rendered anywhere - straight off `sap.m.Token#getKey()`; `removeByText` then clicks the resulting
token's delete icon and the token is confirmed gone from `tokens()`. See
[`examples/tests/multi-input.spec.ts`](../examples/tests/multi-input.spec.ts).

## Related

- [docs/form-inputs.md](form-inputs.md) - `Ui5Select`/`Ui5DatePicker`, the same "read the real
  control state, drive the real interaction" approach for single-value fields
- [docs/smart-controls.md](smart-controls.md) - `Ui5SmartFilterBar`, whose generated fields can
  themselves be `MultiInput`-shaped
