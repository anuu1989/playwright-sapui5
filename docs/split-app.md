# `Ui5SplitApp`

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5SplitApp` reads a `sap.m.SplitApp`'s current state - the classic master/detail responsive
shell. If the app you're testing uses the newer three-column shell instead, see
[docs/flexible-column-layout.md](flexible-column-layout.md) for `Ui5FlexibleColumnLayout`.

```ts
const shell = ui5(page).controlType('sap.m.SplitApp'); // optional - see below

expect(await Ui5SplitApp.mode(page, shell)).toBe('ShowHideMode');
const { master, detail } = await Ui5SplitApp.currentPages(page, shell);
```

## Why this needs a helper

On a narrow screen, `SplitApp` can hide the master page behind a toggle (`ShowHideMode`) or a
popover (`PopoverMode`) rather than removing it from the DOM outright - so "is the master page
visible?" doesn't reliably answer "is it the current page". `getMode()` and
`getCurrentMasterPage()`/`getCurrentDetailPage()` are the control's own honest answers, which is
what this reads - the same problem `Ui5FlexibleColumnLayout` solves for the newer shell, and the
same solution.

## API

```ts
Ui5SplitApp.mode(target, splitApp?): Promise<string | undefined>;
Ui5SplitApp.currentPages(target, splitApp?): Promise<{ master?: string; detail?: string }>;
```

`mode()` returns SAPUI5's own `sap.m.SplitAppMode` enum value - `'ShowHideMode'`,
`'StretchCompressMode'`, `'PopoverMode'` or `'HideMode'`. `currentPages()` returns each side's
current page by control id, `undefined` for whichever side isn't displaying anything.

The locator is optional, the same convention `Ui5FlexibleColumnLayout` uses - an app almost always
has exactly one `SplitApp`, so both methods default to finding the single one on the page:

```ts
await Ui5SplitApp.mode(page); // no locator needed for the common case
```

## Verified

Against the SAPUI5 SDK's own official `sap.m.sample.SplitApp` sample: `mode()` returning the real
`'ShowHideMode'`, and `currentPages()` returning the real master/detail page ids
(`__xmlview0--master`/`__xmlview0--detail`). The locator-less convenience form was checked to
return the identical result to passing the locator explicitly.

Note: the master-detail demo app used elsewhere in this repo
([`master-detail.spec.ts`](../examples/tests/master-detail.spec.ts)) was originally built on
`SplitApp`/`SplitContainer`, which is why some older text in these docs still mentions it - but as
of this writing it's been rebuilt on `sap.f.FlexibleColumnLayout` instead, which is why this page's
verification uses the SDK's dedicated `SplitApp` sample rather than that demo. A public demo app's
internals can change under you; this is why every claim on this page names exactly what it was
checked against.

## Related

- [docs/flexible-column-layout.md](flexible-column-layout.md) - the newer three-column shell,
  same problem, same kind of solution
- [docs/demo-apps.md](demo-apps.md) - real demo apps, including the one this shell used to back
