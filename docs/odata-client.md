# `Ui5ODataClient` (direct API access for setup/teardown)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5ODataClient` talks straight to an OData V2 service - creating, updating and deleting records
without going through the UI at all. It exists for **test setup and teardown**: seeding the record
your test is about to open, or cleaning up what it created, by driving the UI for that is slow and
couples your setup step to whatever the UI happens to look like this week.

```ts
import { Ui5ODataClient } from 'playwright-sapui5';

const odata = await Ui5ODataClient.create(page.request, 'https://your-service/odata/v2/MyService');

const created = await odata.create('Products', { ProductID: 'P1', Name: 'Widget' });
await odata.update("Products('P1')", { Name: 'Renamed Widget' });
const current = await odata.read("Products('P1')");
await odata.delete("Products('P1')");
```

## Why this needs a client at all - the CSRF handshake

SAP Gateway (the OData V2 stack behind most Fiori backends) rejects every write
(`POST`/`PUT`/`MERGE`/`DELETE`) with `403 Forbidden` unless the request carries a **CSRF token**
obtained from a prior `GET` sent with the header `X-CSRF-Token: Fetch`. `Ui5ODataClient.create()`
runs that handshake once and attaches the resulting token to every write it makes afterward - the
whole reason this exists instead of "just use `fetch()`".

## Built on Playwright's own `APIRequestContext`

`Ui5ODataClient.create()` takes an `APIRequestContext` - the `request` fixture, or `page.request` -
not a bare URL and a `fetch()` call. Pass `page.request` specifically and session cookies are
shared automatically with the page under test, so a direct API call reuses whatever the page is
already authenticated as, instead of needing its own separate credentials:

```ts
test('seeds a product before opening it', async ({ page }) => {
  const odata = await Ui5ODataClient.create(page.request, SERVICE_URL);
  await odata.create('Products', { ProductID: 'P1', Name: 'Widget' });

  await page.goto(APP_URL); // already logged in, if the app requires it
  // ... open the product P1 was just seeded as ...

  await odata.delete("Products('P1')"); // clean up regardless of how the test went
});
```

## API

```ts
class Ui5ODataClient {
  static create(
    request: APIRequestContext,
    serviceUrl: string,
    options?: { headers?: Record<string, string> },
  ): Promise<Ui5ODataClient>;

  read(path: string): Promise<unknown>;
  create(entitySet: string, data: Record<string, unknown>): Promise<unknown>;
  update(entityPath: string, data: Record<string, unknown>): Promise<void>;
  delete(entityPath: string): Promise<void>;
}
```

`path`/`entitySet`/`entityPath` are whatever comes after the service root - `'Products'` for a
collection, `"Products('P1')"` for one entity, exactly as you'd write it in the service's own URL.
`options.headers` (e.g. an `Authorization` header) is sent on the CSRF handshake and every request
after it.

`update()` sends `POST` with `X-HTTP-Method: MERGE` (method tunneling) rather than a literal
`MERGE`/`PATCH` request line, because that form is accepted by every SAP Gateway version - some
older ones reject a literal `MERGE`/`PATCH` outright.

## The trap: `page.route()` does not mock this

If you try to fake a backend for `Ui5ODataClient` the way you would for the UI
([docs/odata-mocking.md](odata-mocking.md)), reaching for `page.route()` looks natural - and
silently does nothing. `page.route()` only intercepts requests the **browser page** makes;
`APIRequestContext` calls (what `Ui5ODataClient` is built on) go straight from the Node process and
never touch the page's network stack at all. This framework's own verification hit exactly this
and had to switch to a real local HTTP server instead - see the note in
[`examples/tests/odata-client.spec.ts`](../examples/tests/odata-client.spec.ts).

If you need to test against a fake backend rather than a real one, stand up a real (if local)
server - Node's own `http.createServer`, or a library like `msw`'s Node interceptor - not
`page.route()`.

## Verified

**Real HTTP, no real SAP Gateway.** Verified against a real local Node HTTP server that
faithfully implements the documented CSRF protocol: the handshake happens exactly once and with
the right header, `create()`/`update()`/`delete()` all attach the real token, `update()` sends
`POST` with `X-HTTP-Method: MERGE`, a write with the wrong token is genuinely rejected with `403`
by the server (not just assumed), and `create()` throws a clear error when a service never returns
a token at all. No anonymously-accessible public OData V2 service that both requires CSRF
protection and permits writes was available to verify against instead - the same limitation
[docs/jira.md](jira.md) states plainly about its own mock-server verification.

## Related

- [docs/odata-mocking.md](odata-mocking.md) - mocking a backend for the **UI** to talk to, a
  different problem from this page's direct-API-access one
- [docs/authentication.md](authentication.md) - logging the `page` in once and reusing the session,
  which is what makes `page.request`'s shared cookies useful here
