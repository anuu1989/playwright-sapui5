# Ui5Navigation (routes and hashes)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

SAPUI5 apps are **hash-routed**: `#/category/LT` _is_ the screen you're on, and the URL path never
changes. `Ui5Navigation` reads that and navigates by it. See
[`examples/tests/performance-and-navigation.spec.ts`](../examples/tests/performance-and-navigation.spec.ts)
for complete, real, passing examples.

## Jumping straight to a screen

```ts
await Ui5Navigation.navTo(page, 'category', { id: 'LT' });
```

One line instead of a click-through - which matters when twenty tests all need the same deep
starting state, and none of them are actually testing the clicks that get there.

`routeName` is the name the app gave the route in its `manifest.json` (`"routes"` section), and the
parameters object fills that route's pattern - so the call above suits a route patterned
`category/{id}`.

### Why not just set the hash?

Because assigning `location.hash` only _looks_ like navigation. `navTo()` goes through the app's
own router, so its matched-route handlers, view loading and history entry all run exactly as they
would for a user. An app that reacts to router events can end up half-initialized if you skip
that, producing a screen that looks right but hasn't finished wiring itself up - which then fails
in a way that has nothing obviously to do with how you navigated.

`navTo()` also waits for the app to settle before returning, since a route change usually means
loading a view and fetching its data.

## Reading the hash

```ts
await Ui5Navigation.hash(page); // '#/category/LT'
```

## Confirming a navigation actually happened

```ts
await Ui5Navigation.waitForHash(page, '/category/LT');
```

Takes a substring or a `RegExp`, and is the reliable signal that a **route** change happened - as
opposed to some content merely re-rendering in place.

This matters more than it looks: **SAPUI5's own `navTo` does not throw for a route name that
doesn't exist.** It logs an error and does nothing (verified against a live app). So a typo'd
route name is a silent no-op, and the test carries on against the wrong screen until something
unrelated fails confusingly further down. `waitForHash` turns that into an immediate, clear
failure:

```
[playwright-sapui5] Ui5Navigation.waitForHash: hash did not match /noSuchRouteName within 1500ms.
Current hash: "#/category/LT"
```

`navTo()` _does_ throw if the app has no router at all.

## Related

- [docs/page-objects.md](page-objects.md) - `Ui5Page.goto()` for entering the app in the first
  place; `Ui5Navigation` is for moving around once you're in.
- [docs/flexible-column-layout.md](flexible-column-layout.md) - in a multi-column Fiori shell, the
  route and the column layout are two different pieces of state, both worth asserting on.
