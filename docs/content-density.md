# `Ui5ContentDensity` (compact/cozy content density)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

SAPUI5 controls render at one of two densities: **cozy** (SAPUI5's own default - taller rows,
bigger touch targets) or **compact** (shorter rows, tighter padding - the desktop-with-a-mouse
look most Fiori back-office tools use). Which one's in effect is controlled by nothing more than a
CSS class - `sapUiSizeCompact` or `sapUiSizeCozy` - applied to `<body>` by convention.
`Ui5ContentDensity` reads and forces that class.

```ts
import { Ui5ContentDensity } from 'playwright-sapui5';

await Ui5ContentDensity.set(page, 'compact');
// ... assert whatever should look different in compact mode ...
```

## Why this matters for a test suite

A real Fiori app commonly behaves differently depending on density - a list report's rows are
visibly shorter, a table fits more rows on screen without scrolling, hit targets are smaller. If
your app (or your users) can switch density, or your app picks one based on the device it detects,
that's a real behavioral difference worth testing deliberately rather than only ever exercising
whichever density happens to load by default in CI.

## What `get()` returns, and why `null` is a valid answer

```ts
const density = await Ui5ContentDensity.get(page); // 'compact' | 'cozy' | null
```

`null` means **neither class is present** - which is a real, common state, not a failure to
detect anything: SAPUI5's own default is cozy sizing with _no class needed at all_. Observed
directly against this repo's own demo apps - the Shopping Cart demo, the Browse Orders
master-detail app, and Team Calendar all boot with `null` (no explicit class, plain cozy default),
while the SAPUI5 SDK's own documentation shell boots `'compact'` (a real, different, explicit
starting state) - see [`content-density.spec.ts`](../examples/tests/content-density.spec.ts).

## `set()` takes effect immediately

```ts
await Ui5ContentDensity.set(page, 'compact');
```

This is the same `<body>`-class toggle a real Fiori shell's own density-switcher button performs -
just a CSS class, so there's no async re-render to wait for afterward; the very next reflow (the
next `getBoundingClientRect()`, the next screenshot) already reflects it.

## `toggle()`

```ts
const nowActive = await Ui5ContentDensity.toggle(page); // switches to the other density, returns it
```

Treats `null` (no class present) as `'cozy'` before switching - consistent with `get()`'s own
meaning for `null`.

## API

```ts
type Ui5ContentDensityValue = 'compact' | 'cozy';

class Ui5ContentDensity {
  static get(target: Page | Frame): Promise<Ui5ContentDensityValue | null>;
  static set(target: Page | Frame, density: Ui5ContentDensityValue): Promise<void>;
  static toggle(target: Page | Frame): Promise<Ui5ContentDensityValue>;
}
```

Works against a `Frame` too, the same as everything else in this framework - see
[docs/cross-frame.md](cross-frame.md).

## Scope: `<body>` only

`set()`/`get()` always target `<body>` - the convention every real SAPUI5 app and the framework's
own density-toggle samples use. An app that scopes density to some other container (rather than
the whole page) needs its own `target.evaluate()` call against that container instead; this isn't
guessed at.

## Verified

**Real apps, a real measured rendering difference.** `get()`'s `null` case and `'compact'` case
are both observed live (see above). `set()` is verified to genuinely change rendering, not just
the class: against the SDK's own `sap.m.Table` sample, a `sap.m.ColumnListItem` row's actual
`getBoundingClientRect().height` is measurably shorter in compact than in cozy (43px vs. 57px in
the SAPUI5 theme this framework's suite runs against) - a real rendering effect, not an assumption
about what the CSS class does. See
[`examples/tests/content-density.spec.ts`](../examples/tests/content-density.spec.ts).

## Related

- [docs/visual-testing.md](visual-testing.md) - screenshot testing; consider running your visual
  baselines through both densities if your app supports switching
