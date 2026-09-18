# Core concepts

> New to TypeScript? The code snippets on this page use TypeScript syntax throughout - see
> [docs/typescript-for-beginners.md](typescript-for-beginners.md) if any of it looks unfamiliar.

This page explains _why_ SAPUI5 apps are harder to test than typical web apps, and how this
framework addresses each problem. You don't need to read this to use the framework, but it makes
the rest of the documentation - and any error messages you hit - much easier to understand.

## The problem: SAPUI5 isn't "just HTML"

SAPUI5 (and its open-source twin, OpenUI5) is a component framework. Everything on screen is a
**control** - a JavaScript object (`sap.m.Button`, `sap.m.List`, `sap.m.Input`, ...) that SAPUI5
renders into DOM for you. Three things fall out of that which make plain browser-automation
approaches fragile:

1. **Generated DOM ids.** Unless a control is given an explicit id, SAPUI5 generates one, e.g.
   `__button4-container-cart---welcomeView--promotedRow-0`. These can change between app
   versions, between view instantiations, and sometimes between page loads. Hardcoding a CSS
   selector against one is asking for a test that passes today and breaks on the next deploy.
2. **Asynchronous rendering.** Navigating a SAPUI5 app triggers component/view bootstrapping,
   OData or mock-data requests, and a render pass - all asynchronous, and not always driven by
   something a browser automation tool can observe by default (Playwright's own auto-waiting
   handles element-level actionability, but it can't know that a SAPUI5 list is still fetching
   its data).
3. **Busy states.** SAPUI5 has a first-class notion of "this control/section/app is busy" that
   doesn't necessarily change the DOM in an assertion-visible way (a spinner overlay, low
   opacity) but does mean interacting right now would be premature.

## The fix: talk to SAPUI5 the way SAPUI5 talks to itself

SAPUI5 keeps a live registry of every control currently instantiated in the page, addressable by
its full id, and every control knows its own type (e.g. `sap.m.Button`), its bound data, and its
busy state. This framework injects a small bridge script into the page (see
[`src/browser/bridgeScript.ts`](../src/browser/bridgeScript.ts)) that reads directly from that
registry, and exposes it to your Node-side test code. Concretely:

1. **Resolving a control to a DOM element.** SAPUI5 controls render their root DOM element with
   `id="<the control's own id>"` for the vast majority of controls. So once the bridge finds a
   control matching your criteria (by id, type, binding path, or text) and reads its
   `getId()`, the framework builds a plain Playwright `Locator` from `[id="<that id>"]` and hands
   it to you. From that point on, it's an ordinary Playwright `Locator` - all of Playwright's own
   actionability checks, retries, and APIs apply.
2. **Finding controls by type/text/binding, not DOM structure.** The bridge can filter SAPUI5's
   control registry by control type (`sap.m.Button`), by property values (`{ text: 'Save' }`), by
   OData binding context path, or by visible text - all read from the _control objects_
   themselves, not scraped from rendered HTML. This is far more stable than CSS selectors, which
   depend on exact markup SAPUI5 doesn't promise to keep stable.
3. **Knowing when the app is "settled".** The bridge tracks: SAPUI5's global
   `BusyIndicator.isBusy()`, any individual control's own `busy` property, in-flight
   `fetch`/`XMLHttpRequest` calls (instrumented by the bridge), and whether the control tree
   itself has stopped growing/changing for a short quiet period. `waitForUi5()` polls all of that
   until it's true (or times out). See [docs/auto-wait.md](auto-wait.md) for the full mechanics -
   there's a real, instructive gotcha in there about _when_ the bridge has to be installed
   relative to navigation.

## Why this matters for locator design

Because the framework resolves controls via SAPUI5's own registry rather than the DOM, you should
prefer locators built from things _you_ control or that are _inherent to the app's design_ -
not from SAPUI5's auto-generated id fragments:

- **Good:** a control's explicit id (one you, or the app's developers, assigned)
- **Good:** control type + a stable property (`{ controlType: 'sap.m.Button', properties: { icon: 'sap-icon://cart' } }`)
- **Good:** visible text (`{ text: 'Save' }`) for labels/titles that are part of the app's UX contract
- **Risky:** a raw generated id fragment like `__item0-container-cart---homeView--productList-0` -
  the `__item0` prefix is a global auto-increment counter and can differ between sessions

The example app used throughout this repo's tests hits this exact gotcha - see the note about it
in [docs/troubleshooting.md](troubleshooting.md#unstable-generated-ids).

## Why controls without a DOM presence don't show up

`getAllElements()` inside the bridge filters SAPUI5's full element registry down to elements that
currently have a real, rendered DOM node (`control.getDomRef()` is non-null). This matters for
two reasons:

- SAPUI5's registry also contains **non-visual objects** - `sap.ui.core.CustomData`,
  `sap.ui.layout.GridData`, routing title providers, and so on - that never render to the DOM at
  all. Filtering them out keeps locator results (and the Page Object generator's output, see
  [docs/generator.md](generator.md)) focused on things you can actually interact with.
- Some controls exist as objects (e.g. a `sap.m.List`'s bound items) before they're actually
  rendered - `sap.m.List` in particular only renders items within its `growing` viewport/threshold
  by default, so a control matching your text/property filter might genuinely not be on screen
  yet. If a locator times out with zero matches, this is one of the first things to check.

## What the framework does _not_ do

- It doesn't replace Playwright - it builds `Locator`s and hands them back to you. You have the
  full Playwright API available at all times via `.resolve()`.
- It doesn't parse or understand SAPUI5 routing, OData models, or i18n. It observes busy state
  and the control tree, which is enough to auto-wait correctly without needing to understand your
  app's specific architecture.
- It doesn't guarantee every possible SAPUI5 app will "just work" out of the box - very old UI5
  versions (roughly pre-1.95) used a different, now-removed control registry API; the bridge
  falls back to those legacy APIs where it can, but hasn't been tested against them. See
  [`src/browser/bridgeScript.ts`](../src/browser/bridgeScript.ts) if you need to adapt it.

## Want to see this traced through the actual code?

Everything above describes the _why_ and the _shape_ of the mechanism. For a step-by-step,
file-by-file walkthrough of exactly what runs - with sequence diagrams - when you call `goto()`
or `.click()`, see [docs/architecture.md](architecture.md).
