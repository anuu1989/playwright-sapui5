/**
 * This function is injected into the browser (via `page.addInitScript` / `page.evaluate`)
 * and never runs in Node. It must be fully self-contained: no imports, no closures over
 * outer scope, because Playwright serializes it with `Function.prototype.toString()`.
 *
 * It exposes `window.__pwSapUi5__`, a small bridge object that lets the Node-side library
 * find SAPUI5 controls by id/type/binding-path/text and read the app's "busy" state,
 * without depending on brittle generated DOM ids or CSS classes.
 *
 * A note for readers new to this codebase: every other file in `src/` is broken into small,
 * focused pieces and imports freely from one another. This file is the one deliberate exception
 * - it's ONE big function with every helper declared inside it, and that's not an accident or a
 * style slip. `page.addInitScript(fn)` and `page.evaluate(fn)` both work by converting `fn` to a
 * string (`fn.toString()`) and running that string as JavaScript *inside the browser tab* -
 * which means only what's textually inside this function's own body actually makes the trip.
 * A normal `import` from another file, or a reference to a variable declared outside this
 * function, would either be silently missing or throw a `ReferenceError` on the browser side,
 * because none of that surrounding context exists over there. See docs/architecture.md#the-browser-bridge-in-detail
 * for the fuller explanation, with a sequence diagram of the whole round trip.
 */
export function bridgeScript(): void {
  // `window as unknown as Record<string, any>` is a type assertion chain (see
  // docs/typescript-for-beginners.md#type-assertions-as): TypeScript's built-in `Window` type has
  // no idea about `sap`, `__pwSapUi5__`, or any other SAPUI5-specific global, so this tells the
  // compiler "trust me, treat `window` as a plain object with string keys and unknown-typed
  // values" instead of fighting it property by property. Going through `unknown` first (rather
  // than casting directly) is TypeScript's way of requiring an extra, deliberate step for a cast
  // this broad.
  const w = window as unknown as Record<string, any>;

  // Both `page.addInitScript` (fires on every future navigation) and the one-off `page.evaluate`
  // call in `Ui5Bridge.ensure()` (fires once, for whatever document is already loaded) can end up
  // running this exact function on the same page. This guard makes that safe: if the bridge is
  // already installed, do nothing and return immediately, rather than re-running all the setup
  // below (which would, for instance, double-wrap `fetch` a second time).
  if (w.__pwSapUi5__) {
    return;
  }

  // `bridge` is the one object this whole function builds up and eventually assigns to
  // `window.__pwSapUi5__`. Everything from here to the end of the function is either instrumenting
  // the page (fetch/XHR tracking) or defining a helper function that gets attached onto `bridge`
  // in the last few lines, so Node-side code (`Ui5Bridge.ts`, `SelfHealingResolver.ts`, `waits.ts`)
  // has something to call into.
  const bridge: Record<string, any> = {
    pendingRequests: 0,
  };
  w.__pwSapUi5__ = bridge;

  // --- Track in-flight network activity as a busy-state signal -----------------------------
  // This section "monkey-patches" (replaces at runtime, keeping the original behavior via a
  // saved reference) the page's own `fetch` and `XMLHttpRequest`, purely to keep a running count
  // of requests that have started but not yet finished. `isBusy()` further down checks this
  // count - a page mid-request is a page you shouldn't be clicking things on yet.
  try {
    const originalFetch = w.fetch as typeof fetch | undefined;
    if (originalFetch) {
      // Replacing `window.fetch` with a `function` (not an arrow function) is deliberate: a
      // regular `function` gets its own `this` from how it's called, which matters here because
      // `.apply(this, args)` below needs to forward whatever `this` the *original* caller used,
      // to behave exactly like the real `fetch` in every other way.
      w.fetch = function (this: unknown, ...args: unknown[]) {
        bridge.pendingRequests++;
        const done = () => {
          // `Math.max(0, ...)` guards against the counter ever going negative, which could
          // otherwise happen if `done` somehow ran twice for the same request.
          bridge.pendingRequests = Math.max(0, bridge.pendingRequests - 1);
        };
        // Call the *real* fetch, then hook both the success and failure paths of the Promise it
        // returns to decrement the counter - a request that fails is still a request that's no
        // longer "in flight," so `done()` has to run on both branches, not just success.
        return (originalFetch as any).apply(this, args).then(
          (res: unknown) => {
            done();
            return res;
          },
          (err: unknown) => {
            done();
            throw err; // re-throw so callers of fetch still see the original failure
          },
        );
      };
    }
  } catch {
    // ignore - fetch instrumentation is best-effort
  }

  try {
    const XHR = w.XMLHttpRequest;
    const originalSend = XHR.prototype.send;
    // Same idea as the `fetch` patch above, but XHR doesn't return a Promise - it's an
    // event-based API, so "the request finished" has to be observed via event listeners instead
    // of a `.then()`.
    XHR.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      bridge.pendingRequests++;
      let settled = false;
      const done = () => {
        // An XHR can fire both a terminal event (`loadend`) and, for an aborted request, `abort`
        // too - this flag stops the counter being decremented twice for the same request.
        if (settled) return;
        settled = true;
        bridge.pendingRequests = Math.max(0, bridge.pendingRequests - 1);
      };
      // `loadend` fires for every possible outcome (success, error, or abort) - it alone would
      // be enough, but `abort` is also listened for explicitly since it's the more semantically
      // direct signal for that specific case.
      this.addEventListener('loadend', done);
      this.addEventListener('abort', done);
      return originalSend.apply(this, args as any);
    };
  } catch {
    // ignore - XHR instrumentation is best-effort
  }

  // --- UI5 control tree helpers --------------------------------------------------------------
  // Everything below this point is read-only: none of it modifies the page, it only reads from
  // SAPUI5's own runtime objects to answer "what controls exist, and what do they look like
  // right now?"

  /** Returns SAPUI5's `sap.ui.core.Core` singleton, or `null` if SAPUI5 hasn't booted (yet, or
   * at all) on this page. Every other helper below that needs the legacy Core API calls this. */
  function getCore(): any {
    if (w.sap && w.sap.ui && typeof w.sap.ui.getCore === 'function') {
      try {
        return w.sap.ui.getCore();
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Does this control currently have a real, rendered DOM node? `try`/`catch` here (and
   * throughout this file) because calling an unfamiliar method on an unfamiliar object is
   * inherently a little risky - a broken/half-initialized control shouldn't be able to crash the
   * whole bridge just because one property lookup on it happened to throw. */
  function hasDomRef(el: any): boolean {
    try {
      return typeof el.getDomRef === 'function' && !!el.getDomRef();
    } catch {
      return false;
    }
  }

  /** Every registered UI5 element, including non-visual ones (CustomData, LayoutData, routing
   * helpers) that never touch the DOM. Prefer `getAllElements()` below in most places. */
  function getAllRegisteredElements(): any[] {
    // UI5 >= ~1.120 keeps the control registry on the `sap/ui/core/Element` module, not on
    // Core anymore. `sap.ui.require` with a single string argument is a *synchronous* probe
    // that returns the module if it's already loaded (it always is, by the time an app has
    // rendered anything) - that's what lets this stay a plain sync function instead of async.
    try {
      const ElementModule =
        w.sap && w.sap.ui && typeof w.sap.ui.require === 'function'
          ? w.sap.ui.require('sap/ui/core/Element')
          : null;
      if (
        ElementModule &&
        ElementModule.registry &&
        typeof ElementModule.registry.all === 'function'
      ) {
        // `registry.all()` returns a plain object keyed by control id, not an array - the
        // `Object.keys(...).map(...)` pattern here (and repeated below for the legacy APIs) is
        // just "turn that object's values into a real array" so the rest of this file can use
        // ordinary array methods (`.filter`, `.map`) on the result.
        const all = ElementModule.registry.all();
        return Object.keys(all).map((k) => all[k]);
      }
    } catch {
      // fall through to legacy APIs below
    }

    // Everything past this point only runs if the modern API above wasn't available - either an
    // older UI5 version, or something unexpected went wrong reading it.
    const core = getCore();
    if (!core) return [];
    try {
      if (typeof core.getElementRegistry === 'function') {
        const registry = core.getElementRegistry();
        return Object.keys(registry).map((k) => registry[k]);
      }
    } catch {
      // fall through
    }
    try {
      if (core.mElements) {
        return Object.keys(core.mElements).map((k) => core.mElements[k]);
      }
    } catch {
      // fall through
    }
    return [];
  }

  /** Registered elements that are actually rendered in the DOM right now - i.e. real, currently
   * locatable controls. Excludes non-visual objects (CustomData, LayoutData, routing/title
   * helpers) and controls that exist but haven't rendered (yet, or ever - e.g. in an inactive tab). */
  function getAllElements(): any[] {
    // Every `findControlsBy*` function below, plus `isBusy()`, `isSettled()`, and
    // `dumpControlTree()`, all start from this one function - `getAllRegisteredElements()`
    // itself is never called directly by anything except this line.
    return getAllRegisteredElements().filter(hasDomRef);
  }

  /** Reads a control's full type name (e.g. `"sap.m.Button"`) off its own metadata - SAPUI5's
   * equivalent of asking an object "what class are you an instance of?" */
  function controlType(el: any): string {
    try {
      const metadata = typeof el.getMetadata === 'function' ? el.getMetadata() : null;
      return metadata && typeof metadata.getName === 'function' ? metadata.getName() : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** Reduces a live control object down to the minimal `{ id, type }` shape that's actually safe
   * to send back to Node - see `Ui5ControlInfo` in `src/core/types.ts` for why. */
  function toControlInfo(el: any): { id: string; type: string } {
    return { id: el.getId(), type: controlType(el) };
  }

  /** Checks a control against a `{ propertyName: expectedValue }` filter (the third argument to
   * `Ui5Locator.controlType(...)`) by calling its getter for each property in turn. */
  function matchesProperties(el: any, properties?: Record<string, unknown>): boolean {
    if (!properties) return true;
    // `.every(...)` short-circuits on the first `false` - a control has to match *every* key in
    // the filter object, not just one of them.
    return Object.keys(properties).every((key) => {
      // SAPUI5 controls follow a strict naming convention: a property called `text` always has a
      // getter called `getText()`. This line builds that getter name from the property name you
      // passed in, e.g. `'icon'` → `'getIcon'`, so callers never have to spell out the `get`
      // prefix themselves.
      const getter = 'get' + key.charAt(0).toUpperCase() + key.slice(1);
      if (typeof el[getter] !== 'function') return false;
      try {
        return el[getter]() === properties[key];
      } catch {
        return false;
      }
    });
  }

  // The property getters checked, in order, by `findControlsByText()` and `dumpControlTree()` -
  // different SAPUI5 control types expose their "visible text" under different property names
  // (a Button has `text`, a Title has `text` too, an Input has `value`, ...), so both functions
  // just try each of these in turn and use whichever one the control actually has.
  const TEXT_GETTERS = ['getText', 'getTitle', 'getValue', 'getLabel', 'getHeaderText'];

  /** Backing implementation for `Ui5Locator.id(...)`. */
  function findControlsById(idSuffix: string, exact?: boolean) {
    return getAllElements()
      .filter((el) => {
        let id: string;
        try {
          id = el.getId();
        } catch {
          return false;
        }
        if (exact) return id === idSuffix;
        // "Ends with `--<idSuffix>`" matches SAPUI5's own view-scoped id convention
        // (`<viewId>--<localId>`) - see docs/core-concepts.md for why this suffix-matching
        // approach (rather than requiring the full id) is the framework's default.
        return id === idSuffix || id.slice(-('--' + idSuffix).length) === '--' + idSuffix;
      })
      .map(toControlInfo);
  }

  /** Backing implementation for `Ui5Locator.controlType(...)`. */
  function findControlsByType(type: string, properties?: Record<string, unknown>) {
    return getAllElements()
      .filter((el) => controlType(el) === type && matchesProperties(el, properties))
      .map(toControlInfo);
  }

  /** Backing implementation for `Ui5Locator.bindingPath(...)`. */
  function findControlsByBindingPath(path: string, type?: string) {
    return getAllElements()
      .filter((el) => {
        if (type && controlType(el) !== type) return false;
        try {
          const ctx = typeof el.getBindingContext === 'function' ? el.getBindingContext() : null;
          return !!ctx && typeof ctx.getPath === 'function' && ctx.getPath() === path;
        } catch {
          return false;
        }
      })
      .map(toControlInfo);
  }

  /** Backing implementation for `Ui5Locator.text(...)`. */
  function findControlsByText(text: string, type?: string, exact?: boolean) {
    return getAllElements()
      .filter((el) => {
        if (type && controlType(el) !== type) return false;
        // Try each candidate getter in `TEXT_GETTERS` in turn; stop at the first one that both
        // exists on this control AND matches. A control might have several of these getters, but
        // only one is likely to be the "real" visible text for that control type.
        for (const getter of TEXT_GETTERS) {
          if (typeof el[getter] !== 'function') continue;
          try {
            const val = el[getter]();
            if (typeof val !== 'string') continue;
            if (exact ? val === text : val.indexOf(text) !== -1) return true;
          } catch {
            // ignore and try next getter
          }
        }
        return false;
      })
      .map(toControlInfo);
  }

  /** Is the app "busy" right now, by any of three independent signals? Used directly by
   * `Ui5Bridge.isBusy()`, and as one half of `isSettled()` below. */
  function isBusy(): boolean {
    // Signal 1: SAPUI5's own global BusyIndicator (`sap.ui.core.BusyIndicator.show()`/`.hide()`),
    // the same mechanism apps use for a full-screen loading overlay.
    try {
      if (
        w.sap &&
        w.sap.ui &&
        w.sap.ui.core &&
        w.sap.ui.core.BusyIndicator &&
        typeof w.sap.ui.core.BusyIndicator.isBusy === 'function' &&
        w.sap.ui.core.BusyIndicator.isBusy()
      ) {
        return true;
      }
    } catch {
      // ignore
    }

    // Signal 2: any fetch/XHR request this script's own instrumentation (above) is still
    // tracking as in-flight.
    if (bridge.pendingRequests > 0) return true;

    // Signal 3: any individual control's own `busy` property (many SAPUI5 controls - tables,
    // panels, whole views - support being set busy independently of the global indicator).
    try {
      const elements = getAllElements();
      for (const el of elements) {
        if (typeof el.getBusy === 'function') {
          try {
            if (el.getBusy()) return true;
          } catch {
            // ignore this control
          }
        }
      }
    } catch {
      // ignore
    }
    return false;
  }

  // Tracks whether the control tree has stopped growing/changing, so callers can wait past the
  // initial component/view bootstrap - a phase that often has nothing "busy" to observe yet,
  // since the app's own bootstrap may not go through fetch/XHR at all (e.g. script-tag module
  // loading), so `isBusy()` alone can return false before a single control has even rendered.
  //
  // These three `let`/`const` bindings live *outside* `isSettled()` itself, at the top level of
  // `bridgeScript()`'s own function body - that's what lets them persist as running state
  // between separate calls to `isSettled()` (each poll tick from `waitForUi5` in Node is a
  // separate call), rather than resetting every time. This works because `bridgeScript()` itself
  // only ever runs once per document (the guard at the very top of this file ensures that), so
  // these variables effectively become part of the page's long-lived state for as long as that
  // document is open.
  let lastControlCount = -1;
  let lastChangeAt = Date.now();
  const QUIET_PERIOD_MS = 500;

  /** The framework's core "has the app settled?" check - not busy, AND the control count hasn't
   * changed for `QUIET_PERIOD_MS`. See docs/auto-wait.md for the full reasoning, and
   * docs/architecture.md for how this gets polled from the Node side. */
  function isSettled(): boolean {
    const count = getAllElements().length;
    if (count !== lastControlCount) {
      // The count just changed (grew, or occasionally shrank) since the last check - reset the
      // "how long has it been quiet" clock.
      lastControlCount = count;
      lastChangeAt = Date.now();
    }
    const quiet = Date.now() - lastChangeAt >= QUIET_PERIOD_MS;
    return quiet && !isBusy();
  }

  /** Backing implementation for `Ui5Bridge.dumpControlTree()`, used only by the Page Object
   * generator (`pw-sapui5 generate`) - see `src/generator/generatePageObjectSource.ts`. Unlike
   * the `findControlsBy*` functions above, this returns *every* control (no filter), each with a
   * couple of extra fields the generator needs. */
  function dumpControlTree() {
    return getAllElements().map((el) => {
      const props: Record<string, string> = {};
      for (const getter of TEXT_GETTERS) {
        if (typeof el[getter] !== 'function') continue;
        try {
          const val = el[getter]();
          if (typeof val === 'string' && val) {
            // Turns a getter name like `'getHeaderText'` into a property name like
            // `'headerText'` for the output object: `getter.slice(3, 4)` is just the 4th
            // character (`'H'`), lowercased, and `getter.slice(4)` is everything after that
            // (`'eaderText'`) - concatenated back together, `'H'.toLowerCase() + 'eaderText'` =
            // `'headerText'`.
            props[getter.slice(3, 4).toLowerCase() + getter.slice(4)] = val;
          }
        } catch {
          // ignore
        }
      }
      let parentId: string | undefined;
      try {
        const parent = typeof el.getParent === 'function' ? el.getParent() : null;
        parentId = parent && typeof parent.getId === 'function' ? parent.getId() : undefined;
      } catch {
        // ignore
      }
      return { id: el.getId(), type: controlType(el), properties: props, parentId };
    });
  }

  // Finally: attach every function Node needs to be able to call onto `bridge` (which is already
  // `window.__pwSapUi5__` at this point, assigned near the top of this function). Everything
  // above this line was either instrumentation (fetch/XHR) or a helper function definition that
  // only exists to be called by another helper, or by one of these eight lines - nothing outside
  // this function, in Node, ever calls `getAllElements()`, `controlType()`, `matchesProperties()`,
  // etc. directly; it only ever reaches these eight, by name, through `window.__pwSapUi5__.<name>`.
  bridge.isCoreReady = () => !!getCore();
  bridge.isBusy = isBusy;
  bridge.isSettled = isSettled;
  bridge.findControlsById = findControlsById;
  bridge.findControlsByType = findControlsByType;
  bridge.findControlsByBindingPath = findControlsByBindingPath;
  bridge.findControlsByText = findControlsByText;
  bridge.dumpControlTree = dumpControlTree;
}
