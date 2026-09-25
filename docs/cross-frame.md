# Testing apps embedded in an iframe (Fiori Launchpad and similar shells)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Fiori Launchpad (and other "shell" apps built the same way) doesn't run your app directly - it
runs its **own** SAPUI5 app in the browser tab, and loads whatever app a tile points to inside an
`<iframe>`. That embedded app boots its own, completely separate SAPUI5 runtime and control tree,
living in a different browser [`Frame`](https://playwright.dev/docs/api/class-frame) than the
shell around it. Everything this framework does - the bridge, locators, auto-wait - is normally
described in terms of a Playwright `Page`, but a `Page` only ever represents the **top-level**
document. Reaching into the iframe's own document needs a `Frame`.

This framework accepts either. See [`examples/tests/cross-frame.spec.ts`](../examples/tests/cross-frame.spec.ts)
for a complete, real, passing example.

## The short version

```ts
import { test, expect } from 'playwright-sapui5';
import { ui5, findUi5Frame, waitForUi5Core, waitForUi5 } from 'playwright-sapui5';

test('embedded app works inside its iframe', async ({ page }) => {
  await page.goto('https://your-launchpad.example.com/');
  await page.getByText('Open My App').click(); // whatever opens the tile

  const appFrame = await findUi5Frame(page);

  await waitForUi5Core(appFrame);
  await waitForUi5(appFrame);

  await ui5(appFrame).controlType('sap.m.Button', { text: 'Save' }).click();
  await expect(await ui5(appFrame).text('Saved').resolve()).toBeVisible();
});
```

Every place you'd normally pass `page`, pass `appFrame` instead. That's the entire adjustment.

## `Ui5Target`: `Page` **or** `Frame`

The framework's core pieces - `Ui5Bridge`, `waitForUi5Core`/`waitForUi5`, `Ui5Locator`'s static
factories (`.id`, `.controlType`, `.bindingPath`, `.text`, `.css`, `.role`), and the `ui5(...)`
helper - are all typed to accept a `Ui5Target`, which is just:

```ts
type Ui5Target = Page | Frame;
```

Internally, this works because `Page` and `Frame` both expose the same `.evaluate()`,
`.waitForFunction()`, `.locator()`, and `.getByRole()` methods this framework actually calls - the
bridge script doesn't care which one it's talking to, and neither does anything built on top of
it. See [docs/architecture.md](architecture.md) for how the bridge itself works; everything there
is unchanged, just aimed at a different target.

One thing is genuinely different: `page.addInitScript(fn)` (which registers `fn` to run in every
future document the `Page` loads, including every iframe) only exists on `Page`, never on `Frame`.
`Ui5Bridge.ensure(target)` handles this for you automatically - given a `Frame`, it finds that
frame's owning `Page` (via `frame.page()`) to register the init script, then separately injects
the bridge into the frame's own _current_ document (in case that document already finished
loading before `ensure()` was called - `addInitScript` only affects future navigations, not
whatever's already there). You never need to think about this distinction yourself; it's exactly
why `Ui5Bridge.ensure()` takes a `Ui5Target` and not specifically a `Page`.

## Finding the right frame: `findUi5Frame()`

```ts
import { findUi5Frame } from 'playwright-sapui5';

const appFrame = await findUi5Frame(page, { timeout: 30000 });
```

`findUi5Frame(page, options?)` polls every frame on `page` **other than its main frame**, and
returns the first one whose own SAPUI5 runtime is ready (`sap.ui.getCore()` exists there). It
deliberately excludes the main frame because in a real Fiori Launchpad, the shell itself is a
SAPUI5 app running in the main frame - a check that didn't exclude it would usually just find the
shell again, not the app embedded inside it.

If your shell can have more than one iframe on screen (multiple open tiles, a split-screen
launchpad), narrow the search with `predicate`:

```ts
const appFrame = await findUi5Frame(page, {
  predicate: (frame) => frame.url().includes('MyAppId'),
});
```

Throws a clear error if nothing matches within the timeout (default 30000ms):

```
[playwright-sapui5] findUi5Frame: no iframe with a ready SAPUI5 core found within 30000ms.
```

If you already know how to get the right `Frame` some other way (`page.frame({ url: ... })`,
`page.frameLocator(...).owner()`, iterating `page.frames()` yourself), you don't need
`findUi5Frame()` at all - anything that gives you a Playwright `Frame` object works.

## Page Objects and frames

`Ui5Page` (the base class for Page Objects - see [docs/page-objects.md](page-objects.md)) is
deliberately **`Page`-only**: its constructor takes a `Page`, and `goto()` calls `page.goto(url)`
directly, which only makes sense for a top-level navigation. A Page Object is meant to represent
one navigable "page" of your app, and an embedded app's iframe doesn't navigate the way a `Page`
does (it's created once, when the shell loads the tile, not once per interaction).

For frame-embedded apps, use the standalone `ui5(appFrame)` helper directly instead of a Page
Object, or write your own small wrapper class around a `Frame` if you want the same
locators-as-getters structure `Ui5Page` gives you for top-level pages - `Ui5Page`'s own source
(`src/core/Ui5Page.ts`) is a short, readable template for what that would look like.

## Current limitations

- **Custom `expect` matchers** (`toHaveUi5Property`, `toHaveUi5Text`, `toBeUi5Busy` - see
  [docs/expect-matchers.md](expect-matchers.md)), **`Ui5Table`**, and **`Ui5Dialog`** are not yet
  frame-aware: internally they resolve a `Locator` and then ask `locator.page()` for the owning
  `Page` to run further bridge calls against - but `Locator.page()` always returns the _top-level_
  `Page`, even for a locator built from a `Frame`, so those bridge calls would run against the
  wrong document. Ordinary `Ui5Locator` actions (`.click()`, `.fill()`, `.getText()`,
  `.isVisible()`, `.isEnabled()`, `.count()`, `.waitFor()`) all work correctly inside a frame -
  it's specifically these three advanced helpers, built on top of locators, that don't yet. If you
  need one of them against a control inside an iframe, resolve the plain Playwright `Locator`
  yourself via `ui5(appFrame)....resolve()` and use Playwright's own built-in assertions/APIs on
  it instead.
- **Nested iframes** (an iframe inside another iframe) aren't specifically tested, though nothing
  about the approach assumes only one level of nesting - `findUi5Frame` would need a frame to
  search from other than `page` (pass any `Frame`'s `.childFrames()` results through your own
  `predicate`, or search `page.frames()` yourself, since it lists every frame on the page
  regardless of nesting depth).
