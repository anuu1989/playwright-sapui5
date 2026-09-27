# Ui5FlexibleColumnLayout (the Fiori multi-column shell)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`sap.f.FlexibleColumnLayout` is the one/two/three-column shell behind most modern Fiori
list-detail-detail apps. See
[`examples/tests/flexible-column-layout.spec.ts`](../examples/tests/flexible-column-layout.spec.ts)
for complete, real, passing examples - run against the Shopping Cart demo, which is itself built
on one.

## Why the DOM can't answer this

**All three columns exist in the markup all the time**, sized by CSS. So "is the detail column
open?" can't be answered by looking for the column's element - it's always there, and checking
whether it's _visible_ means reasoning about widths and responsive breakpoints.

The control knows the real answer. Its `layout` property is a SAPUI5 enum describing the
arrangement exactly:

- `OneColumn`
- `TwoColumnsBeginExpanded`, `TwoColumnsMidExpanded`
- `ThreeColumnsMidExpanded`, `ThreeColumnsEndExpanded`,
  `ThreeColumnsMidExpandedEndHidden`, `ThreeColumnsBeginExpandedEndHidden`
- `MidColumnFullScreen`, `EndColumnFullScreen`

## Reading the layout

```ts
await Ui5FlexibleColumnLayout.layout(page); // 'TwoColumnsMidExpanded'
await Ui5FlexibleColumnLayout.visibleColumnCount(page); // 2
```

`visibleColumnCount()` is the friendlier form for the common "did the detail column open?"
assertion - derived from the enum's own naming, not from anything about the DOM.

The locator argument is optional: an app almost always has exactly one FlexibleColumnLayout, so
it's found for you. Pass one explicitly only for the unusual app that nests more than one.

## Which page is in each column

```ts
const { begin, mid, end } = await Ui5FlexibleColumnLayout.currentPages(page);
```

Control ids of whatever each column is currently showing, `undefined` for a column displaying
nothing. This is what lets you assert on _navigation within a column_, which is invisible from the
outside - in the example test, selecting a category changes the begin column's page from
`homeView` to `category` while the layout itself stays `TwoColumnsMidExpanded`:

```ts
await ui5(page).text('Laptops', { controlType: 'sap.m.StandardListItem' }).click();
await expect
  .poll(async () => (await Ui5FlexibleColumnLayout.currentPages(page)).begin)
  .toContain('category');
```

(`expect.poll` because `currentPages()` reads the state once, without auto-waiting - see
[docs/troubleshooting.md](troubleshooting.md).)

## Forcing a layout

```ts
await Ui5FlexibleColumnLayout.setLayout(page, 'ThreeColumnsEndExpanded');
```

For setting up a state directly - going straight to a three-column arrangement, or checking
responsive behaviour - without clicking through whatever navigation normally produces it. Waits
for the app to settle afterwards, since a layout change re-renders columns.

**Prefer driving the app's own navigation where you can.** Clicking through exercises the routing
your users actually hit; `setLayout` is for arranging a starting state, not for replacing the
interaction under test.

## Related

- [docs/split-app.md](split-app.md) - `sap.m.SplitApp`, the older, simpler master-detail shell.
  (The master-detail demo app in [docs/demo-apps.md](demo-apps.md) has since moved from that shell
  to this one - a reminder that a public demo's internals can change under you.)
- [docs/troubleshooting.md](troubleshooting.md#an-id-locator-matches-two-elements-instead-of-one-and-playwright-refuses-to-act) -
  multi-column shells keep previous pages mounted, which is a common source of ambiguous locators.
