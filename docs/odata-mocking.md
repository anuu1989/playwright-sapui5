# OData mocking

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Most real SAP Fiori apps are backed by an OData service (V2 or V4), consumed through
`sap.ui.model.odata.v2.ODataModel` or `sap.ui.model.odata.v4.ODataModel`. This page covers three
small helpers - `mockODataCollection`, `mockODataEntity`, `mockODataError` - that wrap Playwright's
own `page.route()` with the correct OData JSON envelope shapes, so you don't have to hand-write
them (easy to get wrong, especially OData V2's nested `{ d: { results: [...] } }` form) every time
you want to mock one.

**A scope note up front, in the same spirit as [docs/authentication.md](authentication.md):**
this repo's own example apps (the Shopping Cart demo, the UI5 SDK samples) use static JSON files
or in-memory data, not a real OData service - so there's no live, OData-backed app in this repo to
verify these helpers against end-to-end. What
[`examples/tests/odata-mocking.spec.ts`](../examples/tests/odata-mocking.spec.ts) verifies for
real is the envelope-building and request-interception mechanics themselves (a real `fetch()`
call, against a real page, really intercepted, really returning the right JSON shape) - not
integration with a real `ODataModel`'s data binding. Wiring these into your own OData-backed app
should work the same way `page.route()` always does; this page tells you the right shape to mock,
not something specific to your app's OData service.

## Building blocks, not a fake OData server

These helpers don't parse OData query syntax (`$filter`, `$expand`, `$select`, ...), don't
maintain any server-side state, and don't validate anything about the request. Each one matches a
URL pattern and returns a **fixed** response, every time - the same approach
[`examples/tests/network-mocking.spec.ts`](../examples/tests/network-mocking.spec.ts) already
uses with plain `page.route()`, just pre-shaped for OData's JSON conventions specifically. If you
need genuinely different responses for different query parameters, register more than one route
with more specific URL patterns (or match against `route.request().url()` yourself inside a
single handler).

## Mocking a collection (an entity set, or the result of a query)

```ts
import { mockODataCollection } from 'playwright-sapui5';

await mockODataCollection(page, '**/Products', [
  { ProductID: '1', Name: 'Widget' },
  { ProductID: '2', Name: 'Gadget' },
]);
```

Defaults to the OData **V2** envelope: `{ d: { results: [...] } }`. Pass `{ version: 'v4' }` for
the V4 shape instead: `{ value: [...] }`.

```ts
await mockODataCollection(page, '**/Products', data, { version: 'v4' });
```

Like [`page.route()`](https://playwright.dev/docs/api/class-page#page-route) itself, `urlPattern`
can be a glob string or a `RegExp`, and **must be registered before navigation** - same rule, and
same reason, as installing this framework's own bridge before `page.goto()` - see
[docs/auto-wait.md](auto-wait.md#the-ordering-gotcha-bridge-installation-vs-navigation).

## Mocking a single entity

```ts
import { mockODataEntity } from 'playwright-sapui5';

await mockODataEntity(page, "**/Products('1')", { ProductID: '1', Name: 'Widget' });
```

OData V2 wraps a single entity as `{ d: <entity> }`; V4 returns the entity object directly (real
V4 services typically also include an `@odata.context` field, which this omits by default since
most apps don't assert on it specifically - add it as a regular field in your `data` object
yourself if yours does).

## Mocking an error response

```ts
import { mockODataError } from 'playwright-sapui5';

await mockODataError(page, '**/Products', {
  status: 400,
  code: 'VALIDATION_ERROR',
  message: 'Product name is required',
});
```

Useful for testing your app's own error handling - a failed save, a validation error, a simulated
server outage - without needing a real backend that can be made to fail on demand. Defaults to
`status: 500`, `code: 'INTERNAL_ERROR'`, `message: 'An error occurred'`.

## `__metadata` and other OData V2 conveniences

A real `ODataModel` V2 response often includes a `__metadata: { id, uri, type }` object on each
entity, used for things like navigation properties, create/update operations, and ETags. These
helpers don't add it automatically, since the correct `uri`/`type` values depend entirely on your
own service's metadata document. If your test needs it, include it directly in the objects you
pass in:

```ts
await mockODataCollection(page, '**/Products', [
  {
    __metadata: { id: "Products('1')", uri: "Products('1')", type: 'MyService.Product' },
    ProductID: '1',
    Name: 'Widget',
  },
]);
```

## Combining with UI5-aware locators

Nothing about these helpers is special once the mock is in place - use the rest of this framework
normally against whatever your app renders from the mocked data:

```ts
await mockODataCollection(page, '**/Products', [{ ProductID: '1', Name: 'Widget' }]);

const page1 = new ProductListPage(page);
await page1.open();

await expect(page1.product('Widget')).toBeVisible();
```

## Mocking `$batch` (what real Fiori apps actually send)

Everything above intercepts tidy individual requests like `GET /Products`. A real Fiori app
usually sends none of those: `sap.ui.model.odata.v2.ODataModel` defaults to **`useBatch: true`**,
so it issues **one `POST` to `/$batch`** whose body is a multipart MIME document containing
several embedded HTTP requests, and expects a multipart response containing the matching embedded
responses.

```ts
await mockODataBatch(page, '**/svc/$batch', [
  { data: [{ ProductID: 'HT-1', Name: 'Notebook' }] }, // answers the 1st embedded request
  { data: { ProductID: 'HT-1', Stock: 42 } }, // answers the 2nd
]);
```

`parts` are matched **positionally** to the requests inside the batch the app sent. Each part takes
`data` (an array for a collection, an object for a single entity - the OData envelope is applied
for you), an optional `status`, and `raw: true` to skip the envelope entirely.

### Why this needs a helper

The response format is strict in ways that are easy to get subtly wrong: boundary markers echoed
in the `Content-Type` header, a full HTTP status line and headers _inside_ each part, a blank line
before each body, and **CRLF** line endings throughout - a lone `\n` produces something that looks
correct in a terminal and fails to parse in the app.

### How it's verified

Unlike the other helpers on this page, `mockODataBatch` is tested end to end against a **real
`sap.ui.model.odata.v2.ODataModel` with `useBatch: true`** - the model loads metadata, issues a
genuine batch request, and the test asserts it produced real entities from the mocked response.
For a hand-built multipart document, nothing short of UI5's own parser consuming it would actually
prove it works. See the last test in
[`examples/tests/odata-mocking.spec.ts`](../examples/tests/odata-mocking.spec.ts).

### Scope

Only the read side is generated. Change sets - the nested `multipart/mixed` blocks a batch uses to
carry `POST`/`PUT`/`DELETE` - aren't produced; mock those at a higher level, or assert on the
outgoing request instead.
