# Ui5VariantManagement (saved filter/column configurations)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Variants are the saved filter/column/sort configurations that sit at the top of virtually every
Fiori list report - the dropdown that starts on "Standard". `Ui5VariantManagement` reads them and
switches between them. See
[`examples/tests/fiori-elements-app.spec.ts`](../examples/tests/fiori-elements-app.spec.ts) for a
complete, real, passing example against a live Fiori Elements app.

## Why it needs a helper

**There are two controls, stacked, with the same concept under different method names.** A Fiori
Elements app renders `sap.ui.comp.smartvariants.SmartVariantManagement`, which internally wraps a
newer `sap.m.VariantManagement`:

|                | `SmartVariantManagement` | `sap.m.VariantManagement` |
| -------------- | ------------------------ | ------------------------- |
| Active variant | `getCurrentVariantKey()` | `getSelectedKey()`        |
| The list       | `getVariantItems()`      | `getItems()`              |
| Item label     | `getText()`              | `getTitle()`              |

Both are in the control tree at once, so which one a locator finds depends on how it was written.
This class reads whichever you hand it.

**And switching a variant isn't a cosmetic selection.** It re-applies a whole set of filters,
columns and sort orders - usually meaning a fresh backend round trip. A test that picks a variant
and immediately asserts is reading the _previous_ variant's data.

## Reading

```ts
const vm = ui5(page).controlType('sap.ui.comp.smartvariants.SmartVariantManagement');

await Ui5VariantManagement.variants(page, vm); // [{ key: '*standard*', text: 'Standard' }, ...]
await Ui5VariantManagement.currentKey(page, vm); // '*standard*'
await Ui5VariantManagement.currentName(page, vm); // 'Standard'
```

`'*standard*'` is SAPUI5's own key for the built-in default variant.

## Switching

```ts
await Ui5VariantManagement.selectByName(page, vm, 'My Open Items');
await Ui5VariantManagement.selectByKey(page, vm, 'variant-key-123');
```

Both go through the control's own `activateVariant()` where available, so the app's full apply
logic runs (restoring filters, columns and sorting, and firing the events the app listens for) -
not just a moved selection marker. `setCurrentVariantKey`/`setSelectedKey` are used as fallbacks
for controls that don't expose it.

Both then **wait for the app to settle** before returning, for the re-bind reason above.

`selectByName` resolves the label to its key first, so it works regardless of which of the two
controls you targeted. A name that doesn't exist throws with the list of ones that do:

```
[playwright-sapui5] Ui5VariantManagement.selectByName: no variant named "Nope".
Available: ["Standard","My Open Items"]
```

## Saving new variants

Not covered here. Saving opens a dialog ("Save As", with name/default/apply-automatically fields)
that's an ordinary `sap.m.Dialog` - drive it with [`Ui5Dialog`](ui5-dialog.md) if you need to test
that flow. Most suites only ever _select_ variants, which is what this class is for.

## Related

- [docs/smart-controls.md](smart-controls.md) - the `SmartFilterBar`/`SmartTable` pair a variant
  actually reconfigures.
- [docs/demo-apps.md](demo-apps.md) - the live Fiori Elements app the example runs against.
