# Troubleshooting & FAQ

> New to TypeScript? [docs/typescript-for-beginners.md](typescript-for-beginners.md) explains the
> syntax used in code snippets throughout this page.

## "SyntaxError: Cannot use import statement outside a module" when running `playwright test`

This means Playwright's built-in TypeScript loader failed to activate for your config or test
files - usually caused by a very old Node.js patch version. This framework was built and tested
against **Node 20.0.0**, which hit exactly this error; switching to a current LTS release (via
`nvm install --lts && nvm use --lts`) fixed it immediately. If `node -v` reports something like
`v20.0.0` or `v18.0.0` (an `X.0.0` release, especially one that's a couple of years old), update
to the latest patch of that major version, or to the current LTS.

## <a id="old-nodejs-patch-versions"></a>My tests worked yesterday, nothing changed, now they don't run at all

Check `node -v` first. If you use `nvm` and your shell defaults to an old version (`nvm alias
default <old-version>`), a new terminal session can silently drop back to it. Run `nvm use --lts`
(or pin a `.nvmrc` in your project) to avoid this.

## A locator times out with zero matches, but I can see the control on screen

A few common causes, roughly in order of likelihood:

1. **The control hasn't rendered into the DOM yet**, even though it exists as a bound object.
   `sap.m.List` (and similar) with `growing` enabled only renders items within an initial
   viewport/threshold - a control matching your filter further down the list genuinely has no DOM
   presence until you scroll or the growing threshold increases. See
   [docs/core-concepts.md](core-concepts.md#why-controls-without-a-dom-presence-dont-show-up).
2. **You navigated without going through `Ui5Page.goto()` or waiting first.** Add an explicit
   `await waitForUi5(page)` (or use `Ui5Page.goto()`, which does this for you) before your first
   interaction after navigation.
3. **The property filter doesn't match what you think it does.** `controlType(type, { text: 'Save' })`
   checks `control.getText()` (or whichever getter matches your key) - if the control doesn't
   expose that exact getter, or its value is trimmed/formatted differently than what you're
   passing, it won't match. Double check with the [Page Object generator](generator.md) (it
   prints each control's actual `text`/`title`/`value`/`label` next to its type) or by inspecting
   the control directly in the browser console: `sap.ui.getCore().byId('someId').getText()`.
4. **You're inside an iframe.** The bridge is injected into the top-level frame's page context by
   default; if your app (or the part you're testing) lives in an iframe, you'll need to adapt -
   this isn't currently handled automatically.

## <a id="unstable-generated-ids"></a>A test that used a raw generated id worked once, then failed on the next run

SAPUI5 auto-generates ids like `__item0-container-cart---homeView--productList-0` using a global,
incrementing counter - the numeric part (`__item0`) can differ between sessions depending on how
many other auto-id'd controls were created first. **Never hardcode a raw `__`-prefixed id
fragment** in a test. Prefer:

- An explicit id, if one exists (`this.id('searchField')` for a control with a developer-assigned
  id - these are stable).
- `controlType` + a stable property, or `text` - both read from the live control object, not from
  a brittle numeric fragment.

This framework's own example tests hit this exact issue during development - see the comment in
[`examples/pages/CartPage.ts`](../examples/pages/CartPage.ts) for the real fix that was applied.

## An `id()` locator matches two elements instead of one, and Playwright refuses to act

SAPUI5's `NavContainer` (used for master-detail and page-to-page navigation) keeps the
**previous** page in the DOM after a transition - hidden, so it can transition back in smoothly -
rather than removing it outright. If two pages that were both, at different times, shown in the
same `NavContainer` happen to reuse the same _local_ id (e.g. both views name their title
`page-title`), `id()`'s "ends with `--<value>`" suffix matching will find **both**: the currently
visible one and the hidden previous one. Playwright's strict mode then correctly refuses to click
or assert on an ambiguous multi-element locator rather than silently guessing.

The fix is to use a longer, more specific id suffix that includes enough of the view's own id to
disambiguate - e.g. `category--page-title` instead of just `page-title`. This framework's own
example tests hit exactly this with `CategoryPage`'s `title`/`backButton` locators (both views in
this demo app happen to name their title control `page-title`) - see the comment in
[`examples/pages/CategoryPage.ts`](../examples/pages/CategoryPage.ts) for the real fix.

If you're not sure how much of the id to include, the [Page Object generator](generator.md) shows
you full ids for every control it finds - use enough of the suffix to make it unique to the view
you mean.

## `waitForUi5` / `waitForUi5Core` times out on an app that I know is fine

- Some apps genuinely never reach a fully idle network state (polling, websockets, analytics
  beacons). `waitForUi5Core`'s `networkidle` wait is best-effort and gives up gracefully after its
  timeout rather than hanging - but if your _own_ code is waiting on it directly and not catching
  the rejection, increase the timeout or wrap the call in `.catch(() => {})`.
- If the app uses a custom busy/loading UI that isn't SAPUI5's `BusyIndicator` and doesn't set any
  control's `busy` property, the framework has no way to observe it. Wait for a specific locator
  that only appears once loading finishes instead.

## Self-healing keeps warning about the same locator every run

That's the framework doing its job - your primary strategy for that locator has stopped matching
(a text/property change, a renamed id, etc.), and it's falling back successfully every time
instead of failing. Fix the primary strategy in your Page Object once you see the warning; the
test isn't broken, but it's running slower than it needs to (every fallback attempt costs time up
to its share of the timeout budget before moving to the next one).

## The Page Object generator found 0 controls

Almost always a timing issue - the app hadn't finished bootstrapping when the generator tried to
read the control tree. Increase `--timeout`, or run with `--headed` to watch what's actually
happening in the browser. If the app requires login, see the note in
[docs/generator.md](generator.md#limitations).

## Does this work with OpenUI5, not just SAPUI5?

Yes - OpenUI5 is the open-source core SAPUI5 is built on, and exposes the same
`sap.ui.getCore()` / control registry APIs the bridge relies on.

## Does this work with very old UI5 versions?

The bridge tries the modern `sap/ui/core/Element` registry API first (UI5 ≥ ~1.95), falling
back to the older `Core.getElementRegistry()`/`Core.mElements` APIs if that's unavailable. It was
built and tested against **UI5 1.152**. If you're on something considerably older and hit issues,
[`src/browser/bridgeScript.ts`](../src/browser/bridgeScript.ts) is a single, self-contained,
readable file - a reasonable starting point to adapt.

## Where do I report a bug or ask a question?

This is a plain repository, not a hosted product - open an issue or PR against wherever you're
hosting this code, or adapt the source directly; every file under `src/` is small and documented
enough to modify confidently.
