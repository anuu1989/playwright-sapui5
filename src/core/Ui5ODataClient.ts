import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * A direct OData V2 client for test **setup and teardown** - creating, updating and deleting
 * records straight against the real backend, bypassing the UI entirely. See
 * docs/odata-client.md.
 *
 * The problem this solves: seeding data (or cleaning it up) by driving the UI is slow and
 * couples your setup step to whatever the UI happens to look like this week - exactly the kind of
 * thing that shouldn't be part of the test you're actually trying to run. The reason this isn't
 * just "use `fetch()`" is SAP Gateway's own **CSRF protection**: every write (`POST`/`PUT`/
 * `MERGE`/`DELETE`) is rejected with `403 Forbidden` unless the request carries a token obtained
 * from a prior `GET` sent with `X-CSRF-Token: Fetch` - a two-step handshake that's easy to get
 * wrong and tedious to hand-roll in every test file. This wraps it once.
 *
 * Built on Playwright's own `APIRequestContext` (`request` fixture, or `page.request`)
 * deliberately, not a bare `fetch()` - when you pass the same context the `page` under test is
 * using, session cookies are shared automatically, so a direct API call reuses whatever the page
 * is already authenticated as instead of needing its own separate credentials.
 *
 * ```ts
 * const odata = await Ui5ODataClient.create(page.request, 'https://your-service/odata/v2/MyService');
 * const created = await odata.create('Products', { ProductID: 'P1', Name: 'Widget' });
 * await odata.update("Products('P1')", { Name: 'Renamed Widget' });
 * await odata.delete("Products('P1')");
 * ```
 */
export class Ui5ODataClient {
  private constructor(
    private readonly request: APIRequestContext,
    private readonly serviceUrl: string,
    private csrfToken: string,
    private readonly extraHeaders: Record<string, string>,
  ) {}

  /**
   * Runs the CSRF handshake (`GET` with `X-CSRF-Token: Fetch`) against `serviceUrl` and returns a
   * client holding the token. `options.headers` (e.g. an `Authorization` header) is sent on this
   * request and every one after it.
   */
  static async create(
    request: APIRequestContext,
    serviceUrl: string,
    options: { headers?: Record<string, string> } = {},
  ): Promise<Ui5ODataClient> {
    const url = serviceUrl.replace(/\/+$/, '') + '/';
    const extraHeaders = options.headers ?? {};
    const response = await request.get(url, {
      headers: { 'X-CSRF-Token': 'Fetch', ...extraHeaders },
    });
    const token = response.headers()['x-csrf-token'];
    if (!token) {
      throw new Error(
        `[playwright-sapui5] Ui5ODataClient.create: GET ${url} (status ${response.status()}) did not ` +
          `return an X-CSRF-Token header. Either this service doesn't require CSRF protection - in ` +
          `which case Ui5ODataClient isn't needed, just use request.post()/delete() directly - or the ` +
          `fetch request itself failed; check the status and response body.`,
      );
    }
    return new Ui5ODataClient(request, url, token, extraHeaders);
  }

  /** `GET <serviceUrl><path>` - `path` is whatever comes after the service root, e.g.
   * `"Products"` or `"Products('P1')"`. Returns the parsed JSON body. */
  async read(path: string): Promise<unknown> {
    const response = await this.request.get(this.serviceUrl + path, { headers: this.extraHeaders });
    this.assertOk(response, 'GET', path);
    return response.json();
  }

  /** `POST <serviceUrl><entitySet>` with the CSRF token attached - creates a new entity. Returns
   * the parsed JSON body (the created entity, per OData convention). */
  async create(entitySet: string, data: Record<string, unknown>): Promise<unknown> {
    const response = await this.request.post(this.serviceUrl + entitySet, {
      headers: { ...this.extraHeaders, 'X-CSRF-Token': this.csrfToken },
      data,
    });
    this.assertOk(response, 'POST', entitySet);
    return response.json();
  }

  /**
   * Updates an existing entity via OData V2's `MERGE` (partial update - only the fields in `data`
   * change). Sent as `POST` with `X-HTTP-Method: MERGE` - method tunneling, rather than a literal
   * `MERGE` HTTP verb - because that's the form every SAP Gateway version accepts; some older ones
   * reject a literal `MERGE`/`PATCH` request line outright.
   */
  async update(entityPath: string, data: Record<string, unknown>): Promise<void> {
    const response = await this.request.post(this.serviceUrl + entityPath, {
      headers: {
        ...this.extraHeaders,
        'X-CSRF-Token': this.csrfToken,
        'X-HTTP-Method': 'MERGE',
      },
      data,
    });
    this.assertOk(response, 'MERGE', entityPath);
  }

  /** `DELETE <serviceUrl><entityPath>` with the CSRF token attached. */
  async delete(entityPath: string): Promise<void> {
    const response = await this.request.delete(this.serviceUrl + entityPath, {
      headers: { ...this.extraHeaders, 'X-CSRF-Token': this.csrfToken },
    });
    this.assertOk(response, 'DELETE', entityPath);
  }

  private assertOk(response: APIResponse, method: string, path: string): void {
    if (response.ok()) return;
    throw new Error(
      `[playwright-sapui5] Ui5ODataClient: ${method} ${path} failed: ${response.status()} ${response.statusText()}`,
    );
  }
}
