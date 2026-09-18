/**
 * This function is injected into the browser (via `page.addInitScript` / `page.evaluate`)
 * and never runs in Node. It must be fully self-contained: no imports, no closures over
 * outer scope, because Playwright serializes it with `Function.prototype.toString()`.
 *
 * It exposes `window.__pwSapUi5__`, a small bridge object that lets the Node-side library
 * find SAPUI5 controls by id/type/binding-path/text and read the app's "busy" state,
 * without depending on brittle generated DOM ids or CSS classes.
 */
export function bridgeScript(): void {
  const w = window as unknown as Record<string, any>;

  if (w.__pwSapUi5__) {
    return;
  }

  const bridge: Record<string, any> = {
    pendingRequests: 0,
  };
  w.__pwSapUi5__ = bridge;

  // --- Track in-flight network activity as a busy-state signal -----------------------------
  try {
    const originalFetch = w.fetch as typeof fetch | undefined;
    if (originalFetch) {
      w.fetch = function (this: unknown, ...args: unknown[]) {
        bridge.pendingRequests++;
        const done = () => {
          bridge.pendingRequests = Math.max(0, bridge.pendingRequests - 1);
        };
        return (originalFetch as any).apply(this, args).then(
          (res: unknown) => {
            done();
            return res;
          },
          (err: unknown) => {
            done();
            throw err;
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
    XHR.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      bridge.pendingRequests++;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        bridge.pendingRequests = Math.max(0, bridge.pendingRequests - 1);
      };
      this.addEventListener('loadend', done);
      this.addEventListener('abort', done);
      return originalSend.apply(this, args as any);
    };
  } catch {
    // ignore - XHR instrumentation is best-effort
  }

  // --- UI5 control tree helpers --------------------------------------------------------------
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
        const all = ElementModule.registry.all();
        return Object.keys(all).map((k) => all[k]);
      }
    } catch {
      // fall through to legacy APIs below
    }

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
    return getAllRegisteredElements().filter(hasDomRef);
  }

  function controlType(el: any): string {
    try {
      const metadata = typeof el.getMetadata === 'function' ? el.getMetadata() : null;
      return metadata && typeof metadata.getName === 'function' ? metadata.getName() : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function toControlInfo(el: any): { id: string; type: string } {
    return { id: el.getId(), type: controlType(el) };
  }

  function matchesProperties(el: any, properties?: Record<string, unknown>): boolean {
    if (!properties) return true;
    return Object.keys(properties).every((key) => {
      const getter = 'get' + key.charAt(0).toUpperCase() + key.slice(1);
      if (typeof el[getter] !== 'function') return false;
      try {
        return el[getter]() === properties[key];
      } catch {
        return false;
      }
    });
  }

  const TEXT_GETTERS = ['getText', 'getTitle', 'getValue', 'getLabel', 'getHeaderText'];

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
        return id === idSuffix || id.slice(-('--' + idSuffix).length) === '--' + idSuffix;
      })
      .map(toControlInfo);
  }

  function findControlsByType(type: string, properties?: Record<string, unknown>) {
    return getAllElements()
      .filter((el) => controlType(el) === type && matchesProperties(el, properties))
      .map(toControlInfo);
  }

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

  function findControlsByText(text: string, type?: string, exact?: boolean) {
    return getAllElements()
      .filter((el) => {
        if (type && controlType(el) !== type) return false;
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

  function isBusy(): boolean {
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

    if (bridge.pendingRequests > 0) return true;

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
  let lastControlCount = -1;
  let lastChangeAt = Date.now();
  const QUIET_PERIOD_MS = 500;

  function isSettled(): boolean {
    const count = getAllElements().length;
    if (count !== lastControlCount) {
      lastControlCount = count;
      lastChangeAt = Date.now();
    }
    const quiet = Date.now() - lastChangeAt >= QUIET_PERIOD_MS;
    return quiet && !isBusy();
  }

  function dumpControlTree() {
    return getAllElements().map((el) => {
      const props: Record<string, string> = {};
      for (const getter of TEXT_GETTERS) {
        if (typeof el[getter] !== 'function') continue;
        try {
          const val = el[getter]();
          if (typeof val === 'string' && val) {
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

  bridge.isCoreReady = () => !!getCore();
  bridge.isBusy = isBusy;
  bridge.isSettled = isSettled;
  bridge.findControlsById = findControlsById;
  bridge.findControlsByType = findControlsByType;
  bridge.findControlsByBindingPath = findControlsByBindingPath;
  bridge.findControlsByText = findControlsByText;
  bridge.dumpControlTree = dumpControlTree;
}
