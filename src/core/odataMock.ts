import type { Page } from '@playwright/test';

/**
 * Ergonomic wrappers around Playwright's own `page.route()`, purpose-built for the JSON envelope
 * shapes SAPUI5's `sap.ui.model.odata.v2.ODataModel` and `sap.ui.model.odata.v4.ODataModel`
 * expect - most real Fiori apps are OData-backed, and hand-writing the correct envelope by hand
 * every time (V2 wraps a collection as `{ d: { results: [...] } }`; V4 as `{ value: [...] }` -
 * easy to get wrong, especially the V2 form) is exactly the kind of thing worth a small helper
 * for. See docs/odata-mocking.md, including an important scope note: this repo's own example
 * apps use static JSON, not a real OData service, so the envelope-building here is verified
 * standalone (see `examples/tests/odata-mocking.spec.ts`) rather than against a live
 * ODataModel-backed app in this repo's own suite.
 */

export type ODataVersion = 'v2' | 'v4';

export interface MockODataCollectionOptions {
  /** Which OData JSON envelope shape to use. Default `'v2'`. */
  version?: ODataVersion;
  /** HTTP status code for the mocked response. Default `200`. */
  status?: number;
}

/**
 * Mocks a GET request matching `urlPattern` (same pattern syntax as `page.route()` - a glob
 * string or a `RegExp`) as an OData **collection** response (an entity set, or the result of a
 * `$filter`/`$expand` query on one) containing `data`, wrapped in the correct envelope for
 * `options.version`.
 *
 * ```ts
 * await mockODataCollection(page, '**\/Products', [
 *   { ProductID: '1', Name: 'Widget' },
 *   { ProductID: '2', Name: 'Gadget' },
 * ]);
 * ```
 *
 * Must be called **before navigation** - same rule as every other `page.route()` usage (and as
 * installing this framework's own bridge before `page.goto()`) - see
 * docs/auto-wait.md#the-ordering-gotcha-bridge-installation-vs-navigation.
 */
export async function mockODataCollection(
  page: Page,
  urlPattern: string | RegExp,
  data: Record<string, unknown>[],
  options: MockODataCollectionOptions = {},
): Promise<void> {
  const version = options.version ?? 'v2';
  const status = options.status ?? 200;
  await page.route(urlPattern, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(version === 'v2' ? { d: { results: data } } : { value: data }),
    }),
  );
}

/**
 * Mocks a GET request matching `urlPattern` as a **single entity** response (e.g. `GET
 * Products('1')`), wrapped in the correct envelope for `options.version`. OData V2 wraps a single
 * entity as `{ d: <entity> }`; V4 returns the entity object directly (optionally with an
 * `@odata.context` field real V4 services include, which this omits by default since most apps
 * don't assert on it - pass it as a regular field in `data` yourself if yours does).
 */
export async function mockODataEntity(
  page: Page,
  urlPattern: string | RegExp,
  data: Record<string, unknown>,
  options: MockODataCollectionOptions = {},
): Promise<void> {
  const version = options.version ?? 'v2';
  const status = options.status ?? 200;
  await page.route(urlPattern, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(version === 'v2' ? { d: data } : data),
    }),
  );
}

export interface MockODataErrorOptions {
  /** Which OData JSON error envelope shape to use. Default `'v2'`. */
  version?: ODataVersion;
  /** HTTP status code. Default `500`. */
  status?: number;
  /** OData error code (the `error.code` field). Default `'INTERNAL_ERROR'`. */
  code?: string;
  /** Human-readable error message (the `error.message` field). Default `'An error occurred'`. */
  message?: string;
}

/**
 * Mocks a request matching `urlPattern` as a failed OData call - useful for testing your app's
 * own error handling (a failed save, a validation error, a server outage) without needing a real
 * backend that can be made to fail on demand.
 *
 * ```ts
 * await mockODataError(page, '**\/Products', {
 *   status: 400,
 *   code: 'VALIDATION_ERROR',
 *   message: 'Product name is required',
 * });
 * ```
 */
export async function mockODataError(
  page: Page,
  urlPattern: string | RegExp,
  options: MockODataErrorOptions = {},
): Promise<void> {
  const version = options.version ?? 'v2';
  const status = options.status ?? 500;
  const code = options.code ?? 'INTERNAL_ERROR';
  const message = options.message ?? 'An error occurred';
  await page.route(urlPattern, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(
        version === 'v2'
          ? { error: { code, message: { lang: 'en', value: message } } }
          : { error: { code, message } },
      ),
    }),
  );
}
