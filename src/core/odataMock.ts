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

/** One embedded response inside a mocked `$batch` reply - the result the app should see for the
 * corresponding request in the batch it sent. `status` defaults to 200. See `mockODataBatch`. */
export interface MockODataBatchPart {
  /** The JSON payload for this part. Wrapped in the OData envelope automatically unless
   * `raw: true`. For a collection pass an array; for a single entity pass an object. */
  data?: unknown;
  status?: number;
  /** Skip the `{ d: ... }` / `{ value: ... }` envelope and send `data` exactly as given - for
   * responses that aren't entity reads (a function import, a `$count`, an error body). */
  raw?: boolean;
}

/**
 * Mocks an OData **`$batch`** response - the single hardest part of a real Fiori app to fake.
 *
 * Why it needs its own function: `sap.ui.model.odata.v2.ODataModel` defaults to `useBatch: true`,
 * so a production S/4HANA-style app doesn't issue the tidy `GET /Products` requests that
 * `mockODataCollection` intercepts. It issues **one `POST` to `/$batch`** whose body is a
 * multipart MIME document containing several embedded HTTP requests, and expects a multipart
 * response containing the matching embedded HTTP responses - each with its own status line,
 * headers, blank line and body, separated by generated boundary markers, with CRLF line endings
 * that the parser is strict about. Hand-rolling that inside a `page.route()` handler is an
 * afternoon of fiddling with `\r\n`; this builds it.
 *
 * `parts` are matched positionally to the requests inside the batch the app sent - the first part
 * answers the first embedded request, and so on.
 *
 * ```ts
 * await mockODataBatch(page, '**\/$batch', [
 *   { data: [{ ProductID: 'HT-1000', Name: 'Notebook' }] }, // first embedded GET
 *   { data: { ProductID: 'HT-1000', Stock: 42 } },          // second embedded GET
 * ]);
 * ```
 *
 * Only the read-side (`GET` inside the batch) shape is generated. Change sets - the nested
 * `multipart/mixed` blocks a batch uses for POST/PUT/DELETE - aren't produced here; mock those at
 * a higher level, or assert on the outgoing request instead.
 */
export async function mockODataBatch(
  page: Page,
  urlPattern: string | RegExp,
  parts: MockODataBatchPart[],
  options: { version?: ODataVersion } = {},
): Promise<void> {
  const version = options.version ?? 'v2';
  // The boundary only has to be a token that doesn't occur in any part's body, and it has to be
  // echoed in the Content-Type header - that pairing is what lets the parser find the parts.
  const boundary = `batchresponse_${Math.random().toString(36).slice(2, 10)}`;
  // OData/MIME is specified in terms of CRLF, and UI5's parser is strict about it - a lone \n
  // here produces a response that looks right in a terminal and fails to parse in the app.
  const CRLF = '\r\n';

  const body =
    parts
      .map((part) => {
        const status = part.status ?? 200;
        const payload = part.raw
          ? part.data
          : Array.isArray(part.data)
            ? envelopeCollection(part.data as unknown[], version)
            : envelopeEntity(part.data ?? {}, version);
        const json = JSON.stringify(payload);
        return [
          `--${boundary}`,
          'Content-Type: application/http',
          'Content-Transfer-Encoding: binary',
          '',
          `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Error'}`,
          'Content-Type: application/json',
          `Content-Length: ${json.length}`,
          '',
          json,
          '',
        ].join(CRLF);
      })
      .join('') + `--${boundary}--${CRLF}`;

  await page.route(urlPattern, (route) =>
    route.fulfill({
      status: 202, // what a real OData V2 gateway returns for an accepted batch
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
      body,
    }),
  );
}

/** The OData envelope a collection comes wrapped in - V2 nests it under `d.results`, V4 under
 * `value`. Shared by the batch builder above and mirroring what `mockODataCollection` sends. */
function envelopeCollection(data: unknown[], version: ODataVersion): unknown {
  return version === 'v2' ? { d: { results: data } } : { value: data };
}

/** The same for a single entity: V2 nests it under `d`, V4 returns it at the top level. */
function envelopeEntity(data: unknown, version: ODataVersion): unknown {
  return version === 'v2' ? { d: data } : data;
}
