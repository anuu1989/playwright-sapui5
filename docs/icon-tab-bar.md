# `Ui5IconTabBar`

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5IconTabBar` reads and switches a row of `sap.m.IconTabFilter` tabs - the tab strip used
throughout Fiori Elements Object Pages, and in plenty of custom apps besides.

```ts
const tabs = ui5(page).controlType('sap.m.IconTabHeader'); // see the note below
const items = await Ui5IconTabBar.items(page, tabs);
expect(items.find((i) => i.text === 'Reviews')?.count).toBe('12');

await Ui5IconTabBar.selectByKey(page, tabs, items[1].key!);
```

## Why this needs a helper at all

Switching a tab is already an ordinary click - a tab is a real control with a real DOM element, so

```ts
await ui5(page).text('Product Information', { controlType: 'sap.m.IconTabFilter' }).click();
```

works fine without this class. What a plain locator genuinely can't get you:

- **A tab's `key`.** It's almost never the visible text, and there's no reliable way to read it
  from the DOM - it only exists on the control.
- **A tab's badge count.** Real bound data (`sap.m.IconTabFilter.count`), rendered inside a nested
  `<span>` with no stable class to hang a selector off.
- **Selecting by key** instead of by whatever label happens to be showing, so a test survives the
  label being retranslated or reworded.

## `sap.m.IconTabBar` vs `sap.m.IconTabHeader`

**Every method here works against either control**, and this matters in practice: verified against
a real Fiori Elements Object Page (SAP's own "Manage Products" SDK demo), the anchor bar's tab
strip is a bare **`sap.m.IconTabHeader`**, not the full `sap.m.IconTabBar` - the Object Page
manages the content-switching part itself and only needs the header for the tabs. Both controls
expose the same `getItems()`/`getSelectedKey()` shape, and `Ui5IconTabBar` reads them without
caring which one it's given, so you can search for either:

```ts
ui5(page).controlType('sap.m.IconTabHeader'); // what a Fiori Elements Object Page actually renders
ui5(page).controlType('sap.m.IconTabBar'); // the standalone composite control
```

## API

```ts
Ui5IconTabBar.items(target, iconTabBar): Promise<Ui5IconTabItem[]>;
Ui5IconTabBar.selectedKey(target, iconTabBar): Promise<string | undefined>;
Ui5IconTabBar.selectByKey(target, iconTabBar, key, options?): Promise<void>;
```

```ts
interface Ui5IconTabItem {
  id: string;
  key: string | undefined;
  text: string | undefined;
  count: string | undefined; // '' when the app set no badge - SAPUI5's own default, not a read failure
}
```

`selectByKey` looks up the matching item's own control id, then clicks it as an ordinary
Playwright click - so it fires exactly the events a real user click would, rather than reaching
into the control's internals to force a selection. It throws with the list of known keys if `key`
doesn't match any tab.

## A real gotcha this surfaced

The SAPUI5 SDK's own documentation site wraps every sample app in its own shell, which can render
its own, unrelated `IconTabHeader` (the SDK's demo-navigation chrome) alongside the app's real one.
`ui5(page).controlType('sap.m.IconTabHeader')` alone can match both. Scope by an id you know
belongs to the app - an Object Page's own anchor bar has the local id `objectPage-anchBar`, so
`ui5(page).id('objectPage-anchBar')` matches only it. (Id-suffix matching needs the **whole**
segment after the last `--` - `.id('anchBar')` alone won't match `...--objectPage-anchBar`, since
`objectPage-anchBar` is one local id, not two; see [docs/locators.md](locators.md).) A parent
locator scopes just as well, the same way you'd disambiguate any other control a demo shell
happens to duplicate.

## Verified

Against a real, live Fiori Elements Object Page (SAP's own "Manage Products" demo, the same app
[docs/demo-apps.md](demo-apps.md) and
[`examples/tests/fiori-elements-app.spec.ts`](../examples/tests/fiori-elements-app.spec.ts) use):
`items()` returning the real four tabs with their real keys and text, `selectedKey()` matching the
initially-active section, and `selectByKey()` actually switching the active tab (confirmed by
re-reading `selectedKey()` afterward and seeing it change to the target).

## Related

- [docs/object-page.md](object-page.md) - `Ui5ObjectPage`, for the sections these tabs switch
  between
- [docs/smart-controls.md](smart-controls.md), [docs/demo-apps.md](demo-apps.md) - the Fiori
  Elements app this was verified against
