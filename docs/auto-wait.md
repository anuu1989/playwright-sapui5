# Auto-waiting

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) first,
> especially [async/await and Promises](typescript-for-beginners.md#async-await-and-promises) -
> every function on this page is asynchronous.

This page explains exactly what the framework waits for, why, and how to tune or bypass it.

## The two functions

### `waitForUi5Core(page, options?)`

Waits until `sap.ui.getCore()` exists - i.e. the SAPUI5 runtime script has loaded and
bootstrapped. Then, best-effort, it also waits for the browser to reach Playwright's own
`networkidle` load state. Default timeout: 30000ms.

Use this once, right after navigating to a SAPUI5 app (or call `Ui5Page.goto()`, which does this
for you).

### `waitForUi5(page, options?)`

The framework's core auto-wait primitive. Waits until **all** of the following are true:

1. SAPUI5's global `sap.ui.core.BusyIndicator.isBusy()` is `false`.
2. No individual control's own `getBusy()` returns `true`.
3. No `fetch`/`XMLHttpRequest` call is in flight (instrumented by the bridge script).
4. The control tree has stopped growing or changing for a short quiet period (500ms).

Default timeout: 15000ms. On a page where SAPUI5 never loads at all, this resolves quickly rather
than hanging - it's safe to call liberally, including on non-UI5 pages.

Every `Ui5Locator` action method (`.click()`, `.fill()`, etc.) calls this automatically before
acting, unless you pass `{ autoWaitUi5: false }`.

## Why "busy" alone isn't enough

It's tempting to think "wait until nothing is busy" is sufficient. It isn't, for one important
reason: **a SAPUI5 app's initial bootstrap doesn't necessarily set any busy state at all.**
Loading the manifest, component, views, and initial data can all happen before a single control
has rendered - and if nothing ever called `BusyIndicator.show()`, a busy-only check would report
"not busy" from the very first millisecond, long before there's anything to interact with.

That's what the fourth condition (control tree quiet period) is for: it directly observes whether
the app's control tree is still actively changing, independent of whether the app's own code
bothered to signal busy state. Empirically (against a real, live SAPUI5 app - see
[`examples/tests/cart.spec.ts`](../examples/tests/cart.spec.ts)), this combination reliably
distinguishes "still bootstrapping" from "ready," even though the control count can plateau
briefly mid-bootstrap before jumping again.

## The ordering gotcha: bridge installation vs. navigation

The bridge instruments `fetch`/`XMLHttpRequest` to track in-flight requests. For that
instrumentation to see a page's _bootstrap_ network activity, it has to be installed **before**
`page.goto()` navigates - Playwright's `page.addInitScript()` only affects documents that load
_after_ it's registered; it can't retroactively attach to a document that's already loading.

This is why `Ui5Page.goto()` calls `Ui5Bridge.ensure(this.page)` **before** `this.page.goto(url)`,
not after:

```ts
// Ui5Page.goto() - simplified
async goto(url: string) {
  await Ui5Bridge.ensure(this.page); // install the bridge first...
  await this.page.goto(url);          // ...then navigate
  await waitForUi5Core(this.page);
  await this.waitForUi5Ready();
}
```

If you're navigating manually instead of via `Ui5Page.goto()` (e.g. `page.goto()` directly in a
test), call `Ui5Bridge.ensure(page)` first if you want fully accurate busy-tracking through the
initial bootstrap:

```ts
import { Ui5Bridge, waitForUi5Core, waitForUi5 } from 'playwright-sapui5';

await Ui5Bridge.ensure(page);
await page.goto(url);
await waitForUi5Core(page);
await waitForUi5(page);
```

In practice, `waitForUi5Core`'s `networkidle` wait covers most of the gap even if you skip this -
but for the CLI generator and `Ui5Page.goto()`, the framework does it for you regardless.

## Tuning

Both functions accept `{ timeout?: number }` (milliseconds):

```ts
await waitForUi5(page, { timeout: 30000 }); // slow app, give it more time
```

Per-action timeouts on `Ui5Locator` methods also apply to the auto-wait step for that call:

```ts
await locator.click({ timeout: 30000 });
```

## When it can't help you

- **Apps that poll, use websockets, or send analytics beacons** may never reach a fully "settled"
  network state. `waitForUi5Core`'s `networkidle` wait is best-effort and won't block forever -
  it times out and moves on.
- **Custom loading UI that isn't SAPUI5's BusyIndicator** (a custom spinner your app renders
  itself, not via `sap.ui.core.BusyIndicator` or a control's `busy` property) won't be detected.
  Wait for a specific locator instead in that case, or set the control's own `busy` property in
  your app if you control it.
- **Non-SAPUI5 pages/iframes** - the bridge does nothing there; `waitForUi5` just resolves
  immediately since nothing SAPUI5-related is ever busy.
