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

  // --- Record every MessageToast, so tests can assert on ones that already vanished ------------
  // `sap.m.MessageToast` is the single most awkward thing in SAPUI5 to assert on: it isn't a
  // control (nothing in the element registry, no id, no `isOpen()`), it renders as a bare
  // `<div class="sapMMessageToast">` appended to the body, and it **removes itself after about
  // three seconds**. A test that clicks a button and then looks for the toast is racing that
  // timer - and loses whenever the machine is slow, which is exactly when CI is slow.
  //
  // Wrapping `MessageToast.show()` sidesteps the race completely: every toast the app ever raises
  // gets appended to a log that persists long after the toast itself is gone, so
  // `Ui5MessageToast.waitForText(...)` can assert on it whenever it likes. The original `show` is
  // always called through to, so the app behaves exactly as it did before.
  const messageToastLog: { text: string; at: number }[] = [];
  let messageToastPatched = false;

  function tryPatchMessageToast(): boolean {
    if (messageToastPatched) return true;
    try {
      // `sap.ui.require('sap/m/MessageToast')` (single-string, synchronous form) returns the
      // module only if it's already loaded - which it won't be at bridge-install time, since the
      // bridge is deliberately injected *before* UI5 itself boots. Hence the retry below.
      if (!w.sap || !w.sap.ui || typeof w.sap.ui.require !== 'function') return false;
      const MessageToast = w.sap.ui.require('sap/m/MessageToast');
      if (!MessageToast || typeof MessageToast.show !== 'function') return false;
      const originalShow = MessageToast.show;
      MessageToast.show = function (this: unknown, ...args: unknown[]) {
        try {
          messageToastLog.push({ text: String(args[0]), at: Date.now() });
        } catch {
          // recording must never break the app's own toast
        }
        return originalShow.apply(this, args);
      };
      messageToastPatched = true;
      return true;
    } catch {
      return false;
    }
  }

  if (!tryPatchMessageToast()) {
    // Not loaded yet - retry on a timer until `sap.m` shows up, then stop. Bounded (roughly a
    // minute at 200ms) so a page that never loads `sap.m` at all doesn't leave a timer running
    // for the lifetime of the document.
    let attempts = 0;
    const patchTimer = setInterval(() => {
      attempts++;
      if (tryPatchMessageToast() || attempts > 300) clearInterval(patchTimer);
    }, 200);
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

  /** Finds `el` (any registered element, by exact id) among currently DOM-rendered controls -
   * the shared lookup used by `getControlProperty`, `getControlText`, `findDescendantControlsByType`,
   * and `getAggregation` below, all of which start from "the one control this exact id means." */
  function findByExactId(id: string): any {
    return getAllElements().find((el) => {
      try {
        return el.getId() === id;
      } catch {
        return false;
      }
    });
  }

  /**
   * Reads one arbitrary property off a control found by exact id - the general-purpose backing
   * implementation for the `toHaveUi5Property`/`toBeUi5Busy` matchers in `src/core/matchers.ts`.
   * Returns a small result object (rather than just the value, or throwing) so the Node side can
   * tell apart "control not found," "control has no such property," and "property is genuinely
   * `undefined`/`null`" - three different situations that matter for a clear assertion failure
   * message.
   */
  function getControlProperty(id: string, propertyName: string) {
    const el = findByExactId(id);
    if (!el) return { found: false, hasProperty: false, value: undefined };
    const getter = 'get' + propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
    if (typeof el[getter] !== 'function')
      return { found: true, hasProperty: false, value: undefined };
    try {
      return { found: true, hasProperty: true, value: el[getter]() };
    } catch {
      return { found: true, hasProperty: false, value: undefined };
    }
  }

  /** Same "found by exact id" lookup as `getControlProperty`, but tries every `TEXT_GETTERS`
   * candidate in turn (like `findControlsByText` does when searching) instead of requiring the
   * caller to know which specific property holds a given control's visible text. Backs the
   * `toHaveUi5Text` matcher. */
  function getControlText(id: string) {
    const el = findByExactId(id);
    if (!el) return { found: false, value: undefined };
    for (const getter of TEXT_GETTERS) {
      if (typeof el[getter] !== 'function') continue;
      try {
        const val = el[getter]();
        if (typeof val === 'string') return { found: true, value: val };
      } catch {
        // try the next getter
      }
    }
    return { found: true, value: undefined };
  }

  /**
   * Every currently-rendered control of `type`, nested anywhere inside the DOM subtree of the
   * control with exact id `containerId` - a "scoped" version of `findControlsByType` that only
   * looks within one specific control instead of the whole page. This is what lets `Ui5Table`
   * find "the rows of *this* table" (not every row of every table on the page) and `Ui5Dialog`
   * find "the buttons in *this* open dialog" (not every same-labeled button elsewhere on the
   * page) - see `src/core/Ui5Table.ts` and `src/core/Ui5Dialog.ts`.
   */
  function findDescendantControlsByType(containerId: string, type: string) {
    const container = findByExactId(containerId);
    const containerDom = container ? container.getDomRef() : null;
    if (!containerDom) return [];
    return getAllElements()
      .filter((el) => {
        if (controlType(el) !== type) return false;
        try {
          const dom = el.getDomRef();
          // `Node.contains(other)` is a standard DOM method: true if `other` is `dom` itself or
          // nested anywhere inside it. Excluding `containerDom === dom` guards against a control
          // somehow matching its own container (shouldn't normally happen, since a container and
          // its own rows/buttons are different controls with different types, but cheap to guard).
          return !!dom && dom !== containerDom && containerDom.contains(dom);
        } catch {
          return false;
        }
      })
      .map(toControlInfo);
  }

  /**
   * Reads one of a control's own *aggregations* (SAPUI5's term for a property that holds other
   * controls, e.g. a `sap.m.Table`'s `columns`, or a `sap.m.ColumnListItem`'s `cells`) by exact
   * container id and aggregation name, and returns the `{ id, type }` of whatever controls it
   * currently holds. Unlike `findDescendantControlsByType` above, this reads the aggregation
   * directly - useful for things like column headers, which are always fully present regardless
   * of what's scrolled into view, unlike rows in a `growing`-enabled table.
   */
  function getAggregation(containerId: string, aggregationName: string) {
    const container = findByExactId(containerId);
    if (!container) return [];
    const getter = 'get' + aggregationName.charAt(0).toUpperCase() + aggregationName.slice(1);
    if (typeof container[getter] !== 'function') return [];
    let result: any;
    try {
      result = container[getter]();
    } catch {
      return [];
    }
    const items = Array.isArray(result) ? result : result ? [result] : [];
    return items.filter((item: any) => item && typeof item.getId === 'function').map(toControlInfo);
  }

  /**
   * Sets several filter values at once on a `sap.ui.comp.smartfilterbar.SmartFilterBar`, via its
   * own `setFilterData(data)` method - the SAPUI5-native way to fill filters, sidestepping the
   * usual pain of automating a SmartFilterBar entirely: its fields are generated dynamically from
   * OData metadata/annotations, so the *widget type* behind any given field (`DatePicker`,
   * `MultiInput`, `ComboBox`, `Switch`, a `DateRangeType` pair, ...) isn't something a test should
   * have to know or special-case. `data`'s shape is `{ propertyName: value }`, matching whatever
   * `getSmartFilterBarData()` below reads back. Backs `Ui5SmartFilterBar.setFilterData()` - see
   * `src/core/Ui5SmartFilterBar.ts`.
   */
  function setSmartFilterBarData(id: string, data: Record<string, unknown>) {
    const el = findByExactId(id);
    if (!el || typeof el.setFilterData !== 'function') return { found: false, ok: false };
    try {
      el.setFilterData(data);
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Reads a SmartFilterBar's current filter values, in the same `{ propertyName: value }` shape
   * `setSmartFilterBarData` accepts - the read half of the pair above. */
  function getSmartFilterBarData(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getFilterData !== 'function') return { found: false, value: undefined };
    try {
      return { found: true, value: el.getFilterData() };
    } catch {
      return { found: true, value: undefined };
    }
  }

  /**
   * Triggers a SmartFilterBar's search directly via its own `search()` method - equivalent to
   * clicking its "Go" button, without needing to find that button (whose visible label is
   * localized, and whose id is auto-generated same as everything else on this control). Backs
   * `Ui5SmartFilterBar.search()`.
   */
  function triggerSmartFilterBarSearch(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.search !== 'function') return { found: false, ok: false };
    try {
      el.search();
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Reads a `sap.ui.comp.smarttable.SmartTable`'s inner table (via its own `getTable()` method,
   * which returns whichever concrete table control it built - `sap.m.Table` *or*
   * `sap.ui.table.Table`, depending on configuration/annotations, decided at runtime, not
   * something a test can assume ahead of time) together with that table's *true* row count, read
   * from its own data binding (`getBinding('rows')` for a grid table, `getBinding('items')` for a
   * response table) rather than counted from the DOM. That distinction is what makes this usable
   * for a `sap.ui.table.Table`-backed SmartTable specifically: a grid table only ever renders a
   * small virtualized "window" of its bound rows, so counting rendered DOM rows there would badly
   * undercount a real result set. Backs `Ui5SmartTable`.
   */
  function getSmartTableInfo(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getTable !== 'function') {
      return { found: false, innerTable: null, rowCount: undefined };
    }
    let table: any;
    try {
      table = el.getTable();
    } catch {
      table = null;
    }
    if (!table) return { found: true, innerTable: null, rowCount: undefined };
    let binding: any;
    try {
      binding =
        typeof table.getBinding === 'function'
          ? table.getBinding('rows') || table.getBinding('items')
          : null;
    } catch {
      binding = null;
    }
    let rowCount: number | undefined;
    try {
      rowCount =
        binding && typeof binding.getLength === 'function' ? binding.getLength() : undefined;
    } catch {
      rowCount = undefined;
    }
    return { found: true, innerTable: toControlInfo(table), rowCount };
  }

  /**
   * Reads the state needed to interact with a `sap.ui.table.Table` (the "grid" table control) -
   * the DOM ids of its currently-*rendered* rows, plus the numbers needed to know which data
   * indices those rows actually correspond to right now. This control **virtualizes** its rows:
   * it keeps a small, fixed pool of `<tr>` elements (sized by `getVisibleRowCount()`) and re-binds
   * them to different data rows as the table scrolls, rather than rendering one DOM row per data
   * row the way `sap.m.Table` does. That's what makes "the id of row N" a moving target here -
   * unlike `Ui5Table`, which can find a row by a stable DOM search - so this returns the *current*
   * mapping (via `getFirstVisibleRow()`) for the Node side to work out which of the pooled row
   * elements, if any, holds a given data index right now. Backs `Ui5GridTable` - see
   * `src/core/Ui5GridTable.ts` and docs/ui5-grid-table.md.
   */
  function getGridTableInfo(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getRows !== 'function') {
      return { found: false, rowCount: undefined, firstVisibleRow: undefined, renderedRows: [] };
    }
    let rows: any[] = [];
    try {
      rows = el.getRows();
    } catch {
      rows = [];
    }
    let rowCount: number | undefined;
    try {
      const binding = typeof el.getBinding === 'function' ? el.getBinding('rows') : null;
      rowCount =
        binding && typeof binding.getLength === 'function' ? binding.getLength() : undefined;
    } catch {
      rowCount = undefined;
    }
    let firstVisibleRow: number | undefined;
    try {
      firstVisibleRow =
        typeof el.getFirstVisibleRow === 'function' ? el.getFirstVisibleRow() : undefined;
    } catch {
      firstVisibleRow = undefined;
    }
    // Of the pooled row elements, only the first `rowCount - firstVisibleRow` (clamped to the
    // pool size) actually hold real data right now - the rest are rendered but empty, sitting
    // past the end of the bound data (exactly what the earlier ValueHelpDialog exploration in
    // this session found: an 8-row pool showing only 4 real rows). Computed arithmetically here,
    // rather than by checking each row's own binding context, so it stays correct even if a
    // future UI5 version changes what an "empty" pooled row's binding context looks like.
    const realCount =
      typeof rowCount === 'number' && typeof firstVisibleRow === 'number'
        ? Math.max(0, Math.min(rows.length, rowCount - firstVisibleRow))
        : rows.length;
    const renderedRows = rows.slice(0, realCount).map(toControlInfo);
    return { found: true, rowCount, firstVisibleRow, renderedRows };
  }

  /**
   * Scrolls a `sap.ui.table.Table` so that data row `rowIndex` becomes one of its currently
   * rendered rows, via the control's own `setFirstVisibleRow(rowIndex)` method - the same API
   * SAPUI5 itself uses for programmatic scrolling (e.g. "scroll to selection"). This is what lets
   * `Ui5GridTable` reach a row beyond whatever's rendered by default, without simulating mouse
   * wheel/scrollbar events against a control that manages its own virtualized rendering. Backs
   * `Ui5GridTable.scrollToRow()`.
   */
  function scrollGridTableToRow(id: string, rowIndex: number) {
    const el = findByExactId(id);
    if (!el || typeof el.setFirstVisibleRow !== 'function') return { found: false, ok: false };
    try {
      el.setFirstVisibleRow(rowIndex);
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Makes an arbitrary value safe to send back to Node. Anything crossing the browser/Node
   * boundary has to be JSON-serializable (see `Ui5ControlInfo` in `src/core/types.ts`), and model
   * data in particular can hold circular references (an OData entity pointing back at its own
   * parent) that would otherwise throw when Playwright tries to serialize the result. The
   * round-trip through `JSON` both strips non-serializable values and turns a circular structure
   * into a clean `undefined` rather than a confusing crash. */
  function toSerializable(value: any): any {
    try {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    } catch {
      return undefined;
    }
  }

  /** Every registered `sap.ui.core.Component` - the top-level objects an app's models (including
   * its i18n bundle) hang off. Used by the i18n/model helpers below; SAPUI5 apps set their models
   * on the component, not on the Core, so this is where "the app's data" actually lives. */
  function getAllComponents(): any[] {
    try {
      const ComponentModule =
        w.sap && w.sap.ui && typeof w.sap.ui.require === 'function'
          ? w.sap.ui.require('sap/ui/core/Component')
          : null;
      if (ComponentModule && ComponentModule.registry && ComponentModule.registry.all) {
        const all = ComponentModule.registry.all();
        return Object.keys(all).map((k) => all[k]);
      }
    } catch {
      // fall through
    }
    return [];
  }

  /**
   * Reads one translated text out of the app's own i18n `ResourceBundle` - the same string the
   * app itself renders, in whatever language it's currently running in, rather than an English
   * literal hardcoded into a test. Backs `Ui5I18n` (see `src/core/Ui5I18n.ts` and
   * docs/i18n.md).
   *
   * `async` because `getResourceBundle()` returns a **Promise** whenever the bundle is configured
   * to load asynchronously (verified against SAP's own Shopping Cart demo, which does exactly
   * that) - this is the one bridge function that genuinely has to await something, and it works
   * because `page.evaluate()` awaits a returned Promise for us.
   */
  async function getI18nText(key: string, args?: unknown[], modelName?: string) {
    const name = modelName || 'i18n';
    const components = getAllComponents();
    const bundles: any[] = [];

    async function collectFrom(owner: any, wantedName: string | undefined) {
      try {
        if (!owner || typeof owner.getModel !== 'function') return;
        const model = owner.getModel(wantedName);
        if (!model || typeof model.getResourceBundle !== 'function') return;
        let bundle = model.getResourceBundle();
        if (bundle && typeof bundle.then === 'function') bundle = await bundle;
        if (bundle && typeof bundle.getText === 'function') bundles.push(bundle);
      } catch {
        // a model that isn't a ResourceModel, or a bundle that failed to load - skip it
      }
    }

    for (const component of components) await collectFrom(component, name);

    // Nothing under the expected model name: fall back to *any* model on any component that
    // looks like a resource bundle, so an app that names its i18n model something else still
    // works without the caller having to know that up front.
    if (bundles.length === 0) {
      for (const component of components) {
        let names: string[] = [];
        try {
          names = component.oModels ? Object.keys(component.oModels) : [];
        } catch {
          names = [];
        }
        for (const modelKey of names) {
          await collectFrom(component, modelKey === 'undefined' ? undefined : modelKey);
        }
      }
    }

    for (const bundle of bundles) {
      try {
        const text = bundle.getText(key, args);
        // A ResourceBundle returns the key itself when there's no such text, so `text !== key` is
        // the portable "did this bundle actually have it" check; `hasText()` (newer UI5) is more
        // direct when available, but only reports on this exact bundle, not its fallbacks.
        const has = typeof bundle.hasText === 'function' && bundle.hasText(key);
        if (has || text !== key) return { found: true, value: text };
      } catch {
        // try the next bundle
      }
    }
    return { found: false, value: undefined };
  }

  /** Finds a model by name - on a specific control if `controlId` is given (which also picks up
   * models set on any of its parents, since `getModel()` walks up the control tree), otherwise on
   * whichever component has one. */
  function findModel(modelName?: string, controlId?: string): any {
    const name = modelName === undefined || modelName === '' ? undefined : modelName;
    if (controlId) {
      const el = findByExactId(controlId);
      try {
        const model = el && typeof el.getModel === 'function' ? el.getModel(name) : null;
        if (model) return model;
      } catch {
        // fall through to components
      }
    }
    for (const component of getAllComponents()) {
      try {
        const model = typeof component.getModel === 'function' ? component.getModel(name) : null;
        if (model) return model;
      } catch {
        // try the next component
      }
    }
    return null;
  }

  /** Reads a value straight out of a model by binding path (e.g. `/Products/0/Name`) - the app's
   * own data, not whatever happens to be rendered as text. Backs `Ui5Model.getProperty()`. */
  function getModelProperty(path: string, modelName?: string, controlId?: string) {
    const model = findModel(modelName, controlId);
    if (!model || typeof model.getProperty !== 'function') {
      return { found: false, value: undefined };
    }
    try {
      return { found: true, value: toSerializable(model.getProperty(path)) };
    } catch {
      return { found: false, value: undefined };
    }
  }

  /**
   * Reads the entire data object a control is currently bound to - e.g. the full OData entity
   * behind one table row, every field of it, including ones the row doesn't render. Backs
   * `Ui5Model.getBindingContextData()`, which is the piece that lets a test assert on real
   * business data rather than on formatted, truncated, localized display text.
   */
  function getBindingContextData(controlId: string, modelName?: string) {
    const el = findByExactId(controlId);
    if (!el) return { found: false, hasContext: false, path: undefined, data: undefined };
    const name = modelName === undefined || modelName === '' ? undefined : modelName;
    try {
      const context =
        typeof el.getBindingContext === 'function' ? el.getBindingContext(name) : null;
      if (!context) return { found: true, hasContext: false, path: undefined, data: undefined };
      return {
        found: true,
        hasContext: true,
        path: typeof context.getPath === 'function' ? context.getPath() : undefined,
        data: toSerializable(
          typeof context.getObject === 'function' ? context.getObject() : undefined,
        ),
      };
    } catch {
      return { found: true, hasContext: false, path: undefined, data: undefined };
    }
  }

  /** Every model name set on any component (`''` standing in for the default, unnamed model) -
   * a debugging aid for "what models does this app even have?", since model names are an
   * app-internal detail nothing in the UI exposes. Backs `Ui5Model.listModels()`. */
  function listModelNames(): string[] {
    const names: string[] = [];
    for (const component of getAllComponents()) {
      try {
        const own = component.oModels ? Object.keys(component.oModels) : [];
        for (const name of own) {
          const normalized = name === 'undefined' ? '' : name;
          if (names.indexOf(normalized) === -1) names.push(normalized);
        }
      } catch {
        // skip this component
      }
    }
    return names;
  }

  /** Every `sap.m.MessageToast` this document has raised since the bridge was installed - see the
   * instrumentation near the top of this file for why these are recorded rather than read off the
   * DOM. Backs `Ui5MessageToast`. */
  function getMessageToasts() {
    tryPatchMessageToast();
    return messageToastLog.slice();
  }

  /** Empties the recorded toast log - call before an action to assert precisely on what *that*
   * action raised, rather than on anything left over from earlier in the test. */
  function clearMessageToasts() {
    messageToastLog.length = 0;
    return true;
  }

  /**
   * Every message currently in SAPUI5's own message model - validation errors, OData backend
   * errors, and anything the app pushed itself. This is what's behind the message popover in a
   * Fiori app's footer, and it's the reliable way to assert "the form reported exactly this
   * error" without hunting for whichever control happens to render it. Backs `Ui5Messages`.
   */
  function getUi5Messages() {
    let data: any[] = [];
    try {
      // UI5 >= 1.118 moved message handling to its own `Messaging` module; older versions keep it
      // on the Core. Same "try modern, fall back to legacy" shape as `getAllRegisteredElements()`.
      const Messaging =
        w.sap && w.sap.ui && typeof w.sap.ui.require === 'function'
          ? w.sap.ui.require('sap/ui/core/Messaging')
          : null;
      if (Messaging && typeof Messaging.getMessageModel === 'function') {
        data = Messaging.getMessageModel().getData() || [];
      } else {
        const core = getCore();
        if (core && typeof core.getMessageManager === 'function') {
          data = core.getMessageManager().getMessageModel().getData() || [];
        }
      }
    } catch {
      return [];
    }

    return data.map((message: any) => {
      // Entries can be live `sap.ui.core.message.Message` objects (getters) or already-plain
      // objects, depending on UI5 version - read whichever shape this one is.
      function read(getterName: string, propertyName: string) {
        try {
          if (typeof message[getterName] === 'function') return message[getterName]();
          return message[propertyName];
        } catch {
          return undefined;
        }
      }
      return {
        type: read('getType', 'type'),
        message: read('getMessage', 'message'),
        description: read('getDescription', 'description'),
        target: read('getTarget', 'target'),
      };
    });
  }

  /** Removes every message from SAPUI5's message model - useful to reset between steps so a later
   * assertion can't be confused by an error raised earlier in the same test. */
  function clearUi5Messages() {
    try {
      const Messaging =
        w.sap && w.sap.ui && typeof w.sap.ui.require === 'function'
          ? w.sap.ui.require('sap/ui/core/Messaging')
          : null;
      if (Messaging && typeof Messaging.removeAllMessages === 'function') {
        Messaging.removeAllMessages();
        return true;
      }
      const core = getCore();
      if (core && typeof core.getMessageManager === 'function') {
        core.getMessageManager().removeAllMessages();
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Reads a dropdown-style control's items (`sap.m.Select`, `sap.m.ComboBox`,
   * `sap.m.MultiComboBox`, and the `sap.ui.comp.smartfield` variants), plus what's selected and
   * whether it's currently open. Backs `Ui5Select` - see `src/core/Ui5Select.ts`.
   *
   * The reason this has to exist: a dropdown's items are `sap.ui.core.Item` objects that, for a
   * `ComboBox`, **have no DOM at all** until the dropdown opens - and even then, what renders is a
   * set of *separate* `sap.m.StandardListItem` controls mirroring them. So the items carrying the
   * keys are not the items you can click, and neither is reachable by an ordinary locator while
   * the dropdown is shut. Reading them straight off the control sidesteps all of that.
   */
  function getSelectInfo(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getItems !== 'function') {
      return { found: false, items: [], selectedKey: undefined, selectedKeys: [], isOpen: false };
    }
    let items: { id: string; key: string | undefined; text: string | undefined }[] = [];
    try {
      items = el.getItems().map((item: any) => ({
        id: typeof item.getId === 'function' ? item.getId() : '',
        key: typeof item.getKey === 'function' ? item.getKey() : undefined,
        text: typeof item.getText === 'function' ? item.getText() : undefined,
      }));
    } catch {
      items = [];
    }
    function safe(getterName: string, fallback: any) {
      try {
        return typeof el[getterName] === 'function' ? el[getterName]() : fallback;
      } catch {
        return fallback;
      }
    }
    return {
      found: true,
      items,
      // Single-select controls expose `selectedKey`; `MultiComboBox` exposes `selectedKeys`.
      selectedKey: safe('getSelectedKey', undefined),
      selectedKeys: safe('getSelectedKeys', []),
      isOpen: !!safe('isOpen', false),
    };
  }

  /** Opens a dropdown via the control's own `open()` - the fallback for when clicking the
   * rendered arrow isn't possible. Backs `Ui5Select`. */
  function openSelect(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.open !== 'function') return { found: false, ok: false };
    try {
      el.open();
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Closes a dropdown via the control's own `close()`. Mainly useful for `MultiComboBox`, whose
   * list deliberately stays open after each selection so more can be picked. */
  function closeSelect(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.close !== 'function') return { found: false, ok: false };
    try {
      el.close();
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Sets a `sap.m.DatePicker`'s value from plain year/month/day numbers, then fires the control's
   * `change` event so the app's own handlers run exactly as they would after a user edit. Backs
   * `Ui5DatePicker.setDate()`.
   *
   * Taking three integers rather than a date string is deliberate, and is the whole point of this
   * function. Dates are the classic source of flaky SAPUI5 tests: typing into the field means
   * matching the control's *display format*, which varies by locale (`Apr 14, 2014` vs
   * `14.04.2014` vs `2014-04-14`), while passing an ISO string like `'2024-03-15'` through
   * `new Date(...)` parses it as **UTC midnight** - which, in any timezone behind UTC, silently
   * becomes the 14th locally. Building the date from parts here, browser-side, is unambiguous in
   * every locale and timezone.
   */
  function setDatePickerDate(id: string, year: number, month: number, day: number) {
    const el = findByExactId(id);
    if (!el || typeof el.setDateValue !== 'function') return { found: false, ok: false };
    try {
      // `month - 1` because JavaScript's Date months are 0-based; callers pass a human 1-12.
      el.setDateValue(new Date(year, month - 1, day));
      if (typeof el.fireChange === 'function') {
        el.fireChange({
          value: typeof el.getValue === 'function' ? el.getValue() : undefined,
          valid: true,
        });
      }
      return {
        found: true,
        ok: true,
        value: typeof el.getValue === 'function' ? el.getValue() : undefined,
      };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Reads a `sap.m.DatePicker`'s current date as plain year/month/day numbers (see
   * `setDatePickerDate` above for why parts rather than a string), alongside the formatted text
   * the field actually displays. Backs `Ui5DatePicker.getDate()`. */
  function getDatePickerDate(id: string) {
    const el = findByExactId(id);
    if (!el)
      return { found: false, year: undefined, month: undefined, day: undefined, value: undefined };
    let date: any = null;
    try {
      date = typeof el.getDateValue === 'function' ? el.getDateValue() : null;
    } catch {
      date = null;
    }
    let value: string | undefined;
    try {
      value = typeof el.getValue === 'function' ? el.getValue() : undefined;
    } catch {
      value = undefined;
    }
    if (!date || typeof date.getFullYear !== 'function') {
      return { found: true, year: undefined, month: undefined, day: undefined, value };
    }
    return {
      found: true,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      value,
    };
  }

  /**
   * Reads a variant management control's saved variants and which one is active. Covers both
   * `sap.ui.comp.smartvariants.SmartVariantManagement` (the Fiori Elements one, keyed by
   * `getCurrentVariantKey`/`getVariantItems`) and the newer `sap.m.VariantManagement` it wraps
   * (`getSelectedKey`/`getItems`) - the two expose the same concept under different method names,
   * which is exactly the sort of thing a test shouldn't have to branch on. Backs
   * `Ui5VariantManagement` - see docs/variant-management.md.
   */
  function getVariantInfo(id: string) {
    const el = findByExactId(id);
    if (!el) return { found: false, currentKey: undefined, variants: [] };

    function safe(getterName: string) {
      try {
        return typeof el[getterName] === 'function' ? el[getterName]() : undefined;
      } catch {
        return undefined;
      }
    }

    // `getCurrentVariantKey` is the SmartVariantManagement spelling; `getSelectedKey` the
    // sap.m.VariantManagement one.
    const currentKey = safe('getCurrentVariantKey') ?? safe('getSelectedKey');
    const rawItems = safe('getVariantItems') ?? safe('getItems') ?? [];

    let variants: { key: string | undefined; text: string | undefined }[] = [];
    try {
      variants = rawItems.map((item: any) => ({
        key: typeof item.getKey === 'function' ? item.getKey() : undefined,
        // Older variant items expose `text`, newer ones `title`.
        text:
          typeof item.getText === 'function'
            ? item.getText()
            : typeof item.getTitle === 'function'
              ? item.getTitle()
              : undefined,
      }));
    } catch {
      variants = [];
    }

    return { found: true, currentKey, variants };
  }

  /**
   * Switches to a saved variant by key. Prefers the control's own `activateVariant()`, which runs
   * the full apply logic (restoring filters, columns, sort order and firing the events the app
   * listens for) rather than just moving a selection marker - `setCurrentVariantKey`/
   * `setSelectedKey` are the fallbacks for controls that don't expose it.
   */
  function selectVariant(id: string, key: string) {
    const el = findByExactId(id);
    if (!el) return { found: false, ok: false };
    try {
      if (typeof el.activateVariant === 'function') {
        el.activateVariant(key);
      } else if (typeof el.setCurrentVariantKey === 'function') {
        el.setCurrentVariantKey(key);
      } else if (typeof el.setSelectedKey === 'function') {
        el.setSelectedKey(key);
      } else {
        return { found: true, ok: false, error: 'control exposes no way to activate a variant' };
      }
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Reads a `sap.f.FlexibleColumnLayout`'s state - the three-column shell behind most modern Fiori
   * list-detail-detail apps. `getLayout()` returns SAPUI5's own layout enum (`'OneColumn'`,
   * `'TwoColumnsMidExpanded'`, `'ThreeColumnsEndExpanded'`, ...), which is the honest answer to
   * "how many columns are showing right now" - a question the DOM answers only very indirectly,
   * since all three columns exist in the markup regardless and are sized by CSS. Backs
   * `Ui5FlexibleColumnLayout` - see docs/flexible-column-layout.md.
   */
  function getFlexibleColumnLayoutInfo(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getLayout !== 'function') {
      return {
        found: false,
        layout: undefined,
        beginPage: undefined,
        midPage: undefined,
        endPage: undefined,
      };
    }
    function currentPageId(getterName: string) {
      try {
        const page = typeof el[getterName] === 'function' ? el[getterName]() : null;
        return page && typeof page.getId === 'function' ? page.getId() : undefined;
      } catch {
        return undefined;
      }
    }
    let layout: string | undefined;
    try {
      layout = el.getLayout();
    } catch {
      layout = undefined;
    }
    return {
      found: true,
      layout,
      beginPage: currentPageId('getCurrentBeginColumnPage'),
      midPage: currentPageId('getCurrentMidColumnPage'),
      endPage: currentPageId('getCurrentEndColumnPage'),
    };
  }

  /** Sets a `sap.f.FlexibleColumnLayout`'s layout directly - the escape hatch for putting the
   * shell into a specific column arrangement without clicking through whatever navigation
   * normally produces it. Backs `Ui5FlexibleColumnLayout.setLayout()`. */
  function setFlexibleColumnLayout(id: string, layout: string) {
    const el = findByExactId(id);
    if (!el || typeof el.setLayout !== 'function') return { found: false, ok: false };
    try {
      el.setLayout(layout);
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Reads a `sap.m.IconTabBar`'s tabs and current selection. `count` is the badge number the app
   * bound onto each tab, if any - real data, not something worth scraping out of the rendered
   * markup. Backs `Ui5IconTabBar` - see docs/icon-tab-bar.md.
   */
  function getIconTabBarInfo(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getItems !== 'function') {
      return { found: false, selectedKey: undefined, items: [] };
    }
    let selectedKey: string | undefined;
    try {
      selectedKey = typeof el.getSelectedKey === 'function' ? el.getSelectedKey() : undefined;
    } catch {
      selectedKey = undefined;
    }
    let items: any[] = [];
    try {
      items = el.getItems().map((item: any) => ({
        id: typeof item.getId === 'function' ? item.getId() : undefined,
        key: typeof item.getKey === 'function' ? item.getKey() : undefined,
        text: typeof item.getText === 'function' ? item.getText() : undefined,
        count: typeof item.getCount === 'function' ? item.getCount() : undefined,
      }));
    } catch {
      items = [];
    }
    return { found: true, selectedKey, items };
  }

  /** Selects a `sap.m.IconTabBar` tab by finding the matching item's own control id - the actual
   * click still happens as an ordinary DOM click via that id (Node-side, in
   * `Ui5IconTabBar.selectByKey()`), so it fires the exact same events a real user click would.
   * This just does the "which id has this key" lookup, since a tab's key is rarely its visible
   * text and isn't otherwise readable from the DOM. */
  function findIconTabBarItemIdByKey(id: string, key: string): string | undefined {
    const info = getIconTabBarInfo(id);
    const item = info.items.find((it: any) => it.key === key);
    return item?.id;
  }

  /**
   * Reads a `sap.uxap.ObjectPageLayout`'s sections and current selection. Object Page display
   * modes (`iconTabBar` mode - top-level sections render as tabs - versus scroll mode - all
   * sections stacked, the anchor bar highlighting as you scroll) look completely different in the
   * DOM but expose the same section/subsection structure through the control's own API, which is
   * what this reads instead of trying to handle both DOM shapes. Backs `Ui5ObjectPage` - see
   * docs/object-page.md.
   */
  function getObjectPageInfo(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getSections !== 'function') {
      return { found: false, selectedSection: undefined, sections: [] };
    }
    let selectedSection: string | undefined;
    try {
      selectedSection =
        typeof el.getSelectedSection === 'function' ? el.getSelectedSection() : undefined;
    } catch {
      selectedSection = undefined;
    }
    let sections: any[] = [];
    try {
      sections = el.getSections().map((section: any) => {
        let subSections: any[] = [];
        try {
          subSections = (
            typeof section.getSubSections === 'function' ? section.getSubSections() : []
          ).map((sub: any) => ({
            id: typeof sub.getId === 'function' ? sub.getId() : undefined,
            title: typeof sub.getTitle === 'function' ? sub.getTitle() : undefined,
          }));
        } catch {
          subSections = [];
        }
        return {
          id: typeof section.getId === 'function' ? section.getId() : undefined,
          title: typeof section.getTitle === 'function' ? section.getTitle() : undefined,
          subSections,
        };
      });
    } catch {
      sections = [];
    }
    return { found: true, selectedSection, sections };
  }

  /** Scrolls (or, in icon-tab mode, switches) to a section by its own id, via the control's real
   * `scrollToSection()` - the same official API SAPUI5's own anchor bar and tab clicks use, so it
   * behaves identically in both display modes without this needing to know which one it's in.
   * Backs `Ui5ObjectPage.scrollToSection()`. */
  function scrollObjectPageToSection(id: string, sectionId: string) {
    const el = findByExactId(id);
    if (!el || typeof el.scrollToSection !== 'function') return { found: false, ok: false };
    try {
      el.scrollToSection(sectionId);
      return { found: true, ok: true };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Reads a `sap.m.SplitApp`'s current state. `mode` is SAPUI5's own `sap.m.SplitAppMode` enum -
   * the thing that decides whether a master page not currently visible is "not showing" or
   * "showing, just collapsed behind a toggle" (`ShowHideMode`/`PopoverMode` on a narrow screen),
   * which the DOM alone can't distinguish. Backs `Ui5SplitApp` - see docs/split-app.md.
   */
  function getSplitAppInfo(id: string) {
    const el = findByExactId(id);
    if (!el || typeof el.getMode !== 'function') {
      return { found: false, mode: undefined, masterPage: undefined, detailPage: undefined };
    }
    function currentPageId(getterName: string) {
      try {
        const page = typeof el[getterName] === 'function' ? el[getterName]() : null;
        return page && typeof page.getId === 'function' ? page.getId() : undefined;
      } catch {
        return undefined;
      }
    }
    let mode: string | undefined;
    try {
      mode = el.getMode();
    } catch {
      mode = undefined;
    }
    return {
      found: true,
      mode,
      masterPage: currentPageId('getCurrentMasterPage'),
      detailPage: currentPageId('getCurrentDetailPage'),
    };
  }

  /**
   * Collects load/performance numbers for the current document. Backs `Ui5Performance.metrics()` -
   * see docs/performance.md.
   *
   * The browser's own Navigation Timing covers the page load, but the number that actually matters
   * for a SAPUI5 app isn't there: UI5 bootstraps *after* `load`, pulling in dozens of library
   * modules before a single control renders, so `loadEvent` can be fast while the app is still
   * blank. `ui5ResourceCount` and `controlCount` are the SAPUI5-side complement - how much the
   * framework pulled in, and how much it actually built.
   */
  function getPerformanceMetrics() {
    const out: Record<string, any> = {
      responseEndMs: undefined,
      domContentLoadedMs: undefined,
      loadEventMs: undefined,
      resourceCount: undefined,
      ui5ResourceCount: undefined,
      controlCount: undefined,
    };
    try {
      const nav = performance.getEntriesByType('navigation')[0] as any;
      if (nav) {
        out.responseEndMs = Math.round(nav.responseEnd);
        out.domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd);
        out.loadEventMs = Math.round(nav.loadEventEnd);
      }
    } catch {
      // Navigation Timing not available - leave the fields undefined
    }
    try {
      const resources = performance.getEntriesByType('resource');
      out.resourceCount = resources.length;
      out.ui5ResourceCount = resources.filter((r: any) =>
        /sap-ui|\/resources\//.test(r.name),
      ).length;
    } catch {
      // ignore
    }
    try {
      out.controlCount = getAllElements().length;
    } catch {
      // ignore
    }
    return out;
  }

  /** The current URL hash. SAPUI5 apps are hash-routed, so this - not the path - is what
   * identifies the screen you're on. Backs `Ui5Navigation.hash()`. */
  function getHash(): string {
    try {
      return location.hash;
    } catch {
      return '';
    }
  }

  /**
   * Navigates using the app's **own router** (`component.getRouter().navTo(...)`) rather than by
   * rewriting the URL. That matters: `navTo` runs the app's real routing logic - matched handlers,
   * view loading, the browser-history entry it expects - whereas assigning `location.hash` only
   * *looks* the same and can leave an app that listens for router events half-initialized.
   * Backs `Ui5Navigation.navTo()`.
   */
  function routerNavTo(routeName: string, parameters?: Record<string, unknown>) {
    try {
      const ComponentModule =
        w.sap && w.sap.ui && typeof w.sap.ui.require === 'function'
          ? w.sap.ui.require('sap/ui/core/Component')
          : null;
      if (!ComponentModule || !ComponentModule.registry) return { found: false, ok: false };
      const all = ComponentModule.registry.all();
      for (const id of Object.keys(all)) {
        const component = all[id];
        const router = typeof component.getRouter === 'function' ? component.getRouter() : null;
        if (router && typeof router.navTo === 'function') {
          router.navTo(routeName, parameters || {});
          return { found: true, ok: true };
        }
      }
      return { found: false, ok: false };
    } catch (e) {
      return { found: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Reads the app's `manifest.json` descriptor - its id, title, declared OData data sources, and
   * crucially its **routing table**. Backs the test generator's app analysis (see
   * `src/generator/analyzeApp.ts` and docs/test-generator.md).
   *
   * The routing table is what makes generating *navigation* tests possible at all: it names every
   * screen the app can reach and the URL pattern for each. A pattern's parameters also say
   * whether a route is safely reachable blind - `category/{id}` needs a real id the generator has
   * no way to invent, while `cart` or `checkout` can simply be navigated to.
   */
  function getAppManifestInfo() {
    const result: Record<string, any> = {
      found: false,
      appId: undefined,
      appTitle: undefined,
      componentName: undefined,
      routerClass: undefined,
      routes: [],
      dataSources: [],
    };
    try {
      const ComponentModule =
        w.sap && w.sap.ui && typeof w.sap.ui.require === 'function'
          ? w.sap.ui.require('sap/ui/core/Component')
          : null;
      if (!ComponentModule || !ComponentModule.registry) return result;
      const all = ComponentModule.registry.all();
      const ids = Object.keys(all);
      if (ids.length === 0) return result;
      const component = all[ids[0]];
      result.found = true;
      try {
        result.componentName = component.getMetadata().getName();
      } catch {
        // ignore
      }

      const manifest = typeof component.getManifest === 'function' ? component.getManifest() : null;
      if (!manifest) return result;

      const app = manifest['sap.app'] || {};
      result.appId = app.id;
      // `title` is often an i18n placeholder like "{{appTitle}}" - the caller resolves it.
      result.appTitle = app.title;
      result.dataSources = app.dataSources ? Object.keys(app.dataSources) : [];

      const routing = (manifest['sap.ui5'] || {}).routing || {};
      result.routerClass = routing.config ? routing.config.routerClass : undefined;
      result.routes = (routing.routes || []).map((route: any) => {
        const pattern = String(route.pattern === undefined ? '' : route.pattern);
        // SAPUI5 route patterns mark required parameters as `{name}` and optional ones as
        // `:name:` - the difference decides whether a route can be navigated to without
        // inventing data.
        const required: string[] = [];
        const optional: string[] = [];
        pattern.replace(/\{([^}]+)\}/g, (_m: string, name: string) => {
          required.push(name);
          return '';
        });
        pattern.replace(/:([^:/]+):/g, (_m: string, name: string) => {
          optional.push(name);
          return '';
        });
        return { name: route.name, pattern, required, optional };
      });
    } catch {
      return result;
    }
    return result;
  }

  /**
   * Every currently-rendered control that reports itself as open right now, via SAPUI5's own
   * `isOpen()` method - both `sap.m.Dialog` and `sap.m.Popover` (and anything else that happens
   * to implement the same method) are covered by this one check, with no need to enumerate
   * specific control type names. Backs `Ui5Dialog`'s "wait for something to open" logic - see
   * `src/core/Ui5Dialog.ts`.
   */
  function findOpenPopups() {
    return getAllElements()
      .filter((el) => {
        if (typeof el.isOpen !== 'function') return false;
        try {
          return el.isOpen();
        } catch {
          return false;
        }
      })
      .map(toControlInfo);
  }

  /** The SAPUI5 binding types that format a value as a date/time - a reliable signal that a
   * control's displayed content is inherently time-based ("today", "2 minutes ago", a live
   * clock), the exact thing that makes a screenshot comparison flaky from one run to the next.
   * Backs `maskDynamicUi5Content()` - see docs/visual-testing.md#masking-dynamic-content. */
  const DATE_TIME_BINDING_TYPES = [
    'sap.ui.model.type.Date',
    'sap.ui.model.type.DateTime',
    'sap.ui.model.type.Time',
    'sap.ui.model.odata.type.Date',
    'sap.ui.model.odata.type.DateTime',
    'sap.ui.model.odata.type.DateTimeOffset',
    'sap.ui.model.odata.type.TimeOfDay',
    'sap.ui.model.odata.type.Time',
  ];

  /**
   * Finds every control with at least one property bound through a date/time formatting type -
   * i.e. declared with `{ path: '...', type: new sap.ui.model.type.DateTime() }` (or the OData
   * V4 equivalents), rather than a bare path. This reads the control's own binding metadata
   * (`mBindingInfos`, the same internal structure SAPUI5 itself uses to know how to format each
   * bound property) - it does not guess from rendered text, which is what makes it reliable: a
   * plain `sap.m.Text` showing the literal string `"2024-01-01"` with no such binding is correctly
   * left alone, while one whose binding actually carries a date/time type is caught regardless of
   * what its formatted output happens to look like right now.
   */
  function findControlsWithDateTimeBinding() {
    return getAllElements()
      .filter((el) => {
        const bindingInfos = el.mBindingInfos;
        if (!bindingInfos || typeof bindingInfos !== 'object') return false;
        return Object.keys(bindingInfos).some((propertyName) => {
          try {
            const type = bindingInfos[propertyName]?.type;
            const typeName =
              type && typeof type.getMetadata === 'function' ? type.getMetadata().getName() : null;
            return !!typeName && DATE_TIME_BINDING_TYPES.indexOf(typeName) !== -1;
          } catch {
            return false;
          }
        });
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
  // only exists to be called by another helper, or by one of the lines below - nothing outside
  // this function, in Node, ever calls `getAllElements()`, `controlType()`, `matchesProperties()`,
  // etc. directly; it only ever reaches these, by name, through `window.__pwSapUi5__.<name>`.
  bridge.isCoreReady = () => !!getCore();
  bridge.isBusy = isBusy;
  bridge.isSettled = isSettled;
  bridge.findControlsById = findControlsById;
  bridge.findControlsByType = findControlsByType;
  bridge.findControlsByBindingPath = findControlsByBindingPath;
  bridge.findControlsByText = findControlsByText;
  bridge.dumpControlTree = dumpControlTree;
  bridge.getControlProperty = getControlProperty;
  bridge.getControlText = getControlText;
  bridge.findDescendantControlsByType = findDescendantControlsByType;
  bridge.getAggregation = getAggregation;
  bridge.findOpenPopups = findOpenPopups;
  bridge.findControlsWithDateTimeBinding = findControlsWithDateTimeBinding;
  bridge.setSmartFilterBarData = setSmartFilterBarData;
  bridge.getSmartFilterBarData = getSmartFilterBarData;
  bridge.triggerSmartFilterBarSearch = triggerSmartFilterBarSearch;
  bridge.getSmartTableInfo = getSmartTableInfo;
  bridge.getGridTableInfo = getGridTableInfo;
  bridge.scrollGridTableToRow = scrollGridTableToRow;
  bridge.getI18nText = getI18nText;
  bridge.getModelProperty = getModelProperty;
  bridge.getBindingContextData = getBindingContextData;
  bridge.listModelNames = listModelNames;
  bridge.getMessageToasts = getMessageToasts;
  bridge.clearMessageToasts = clearMessageToasts;
  bridge.getUi5Messages = getUi5Messages;
  bridge.clearUi5Messages = clearUi5Messages;
  bridge.getSelectInfo = getSelectInfo;
  bridge.openSelect = openSelect;
  bridge.closeSelect = closeSelect;
  bridge.setDatePickerDate = setDatePickerDate;
  bridge.getDatePickerDate = getDatePickerDate;
  bridge.getVariantInfo = getVariantInfo;
  bridge.selectVariant = selectVariant;
  bridge.getFlexibleColumnLayoutInfo = getFlexibleColumnLayoutInfo;
  bridge.setFlexibleColumnLayout = setFlexibleColumnLayout;
  bridge.getIconTabBarInfo = getIconTabBarInfo;
  bridge.findIconTabBarItemIdByKey = findIconTabBarItemIdByKey;
  bridge.getObjectPageInfo = getObjectPageInfo;
  bridge.scrollObjectPageToSection = scrollObjectPageToSection;
  bridge.getSplitAppInfo = getSplitAppInfo;
  bridge.getPerformanceMetrics = getPerformanceMetrics;
  bridge.getHash = getHash;
  bridge.routerNavTo = routerNavTo;
  bridge.getAppManifestInfo = getAppManifestInfo;
}
