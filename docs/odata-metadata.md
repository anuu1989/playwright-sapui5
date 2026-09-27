# Validating mocks against a real `$metadata` document

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

[`mockODataCollection`/`mockODataEntity`](odata-mocking.md) will happily send whatever `data` you
hand them - a typo'd field, a property that got renamed on the backend since you wrote the test,
one that never existed at all. The mock still "works" in the sense that Playwright intercepts the
request; the failure shows up later, deep inside the app, as a control that silently renders blank
or a confusing OData binding error. This feature closes that gap: check `data` against the real
service's own published contract - its `$metadata` document - before the mock is even registered.

```ts
import { fetchODataMetadata, mockODataCollection } from 'playwright-sapui5';

const metadata = await fetchODataMetadata('https://your-service/$metadata');

await mockODataCollection(page, '**/Products', [{ ProductID: '1', ProductName: 'Widget' }], {
  metadata,
  entityType: 'Product',
});
```

If `data` doesn't match `Product`'s real shape, this **throws immediately**, naming the exact
property:

```
Error: [playwright-sapui5] mockODataCollection: mock data doesn't match "Product" in the real
service's $metadata:
  ProductNmae: "ProductNmae" is not a property of "Product". Known properties: ProductID,
  ProductName, SupplierID, ...
```

That's the whole feature. `fetchODataMetadata` is a plain `fetch()` against the service's
`$metadata` endpoint - do it once, reuse the result across every mock in the file.

## What this catches, and what it doesn't

**Reliable, no false positives:** a property name that doesn't exist on the real entity type. This
is the check worth having - it's exactly the typo/rename class of bug that would otherwise only
surface as a silently blank field or a confusing binding error, and there's no legitimate reason a
mock would ever intentionally use a property name the real service doesn't have.

**Best-effort, deliberately narrow:** a value whose type is unambiguously wrong for its EDM type -
a string for `Edm.Boolean`, a non-array for a `Collection(...)` property. It stops there
deliberately. OData V2's JSON serialization represents `Edm.Int64` and `Edm.Decimal` as **quoted
strings** (to avoid JS number precision loss) and dates as `/Date(1234567890000)/`-style strings -
so numeric-vs-string and date-shaped values are never flagged, because doing so would flag
correctly-shaped mocks as broken. Verified directly: `{ UnitPrice: '18.0000' }` against a real
`Edm.Decimal` property produces zero issues.

**Not validated at all:** nested complex-type shapes, whether required/key fields are present, and
expanded navigation-property payloads (an `$expand`ed field is skipped rather than checked, since
its shape is a different entity type's schema entirely).

## API

```ts
function fetchODataMetadata(
  url: string,
  options?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<ODataMetadata>;

function parseODataMetadata(xml: string): ODataMetadata; // if you already have the XML text

function validateAgainstODataMetadata(
  metadata: ODataMetadata,
  entityType: string,
  data: Record<string, unknown> | Record<string, unknown>[],
): ODataValidationIssue[]; // [] means nothing looked wrong
```

```ts
interface ODataValidationIssue {
  path: string; // e.g. 'ProductNmae', or '[2].ProductNmae' for the third record in an array
  message: string;
}
```

`mockODataCollection`/`mockODataEntity` accept the same `metadata`/`entityType` options directly -
see [docs/odata-mocking.md](odata-mocking.md). Call `validateAgainstODataMetadata` yourself if you
just want the issue list without the mock throwing (e.g. to log a warning instead of failing).

## Works with V2 and V4

The parser reads `EntityType`/`Property`/`NavigationProperty` elements, which have the same shape
in both EDMX versions - only the outer namespace URIs differ, and this doesn't care about those.
Verified against two genuinely different, real, live services:
[Northwind (V2)](https://services.odata.org/V2/Northwind/Northwind.svc/) and
[TripPin (V4)](https://services.odata.org/V4/TripPinServiceRW/), including a V4
`Collection(Edm.String)` property parsed and validated correctly.

## No XML library dependency

`parseODataMetadata` is a small, purpose-built scan for EDMX's specific, narrow shape - not a
general XML parser. This framework has exactly one dependency (`commander`, for the CLI); pulling
in a full XML/DOM library for this one job would be a large addition for a small task, the same
reasoning behind hand-building the `$batch` multipart response in
[`odataMock.ts`](../src/core/odataMock.ts) rather than reaching for an OData client SDK.

## Related

- [docs/odata-mocking.md](odata-mocking.md) - the mocking functions this plugs into
- [`examples/tests/odata-metadata.spec.ts`](../examples/tests/odata-metadata.spec.ts) - every claim
  on this page, run against the real live services named above
