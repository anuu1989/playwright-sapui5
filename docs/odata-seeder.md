# `Ui5ODataSeeder` (test-data seeding with guaranteed cleanup)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

[`Ui5ODataClient`](odata-client.md) gives you `create()`/`update()`/`delete()` - the primitives.
`Ui5ODataSeeder` is a thin layer on top for the pattern almost every test that seeds data actually
needs: track what was created, delete all of it afterward, and don't let one test's leftover data
break the next run - even when the test fails partway through and never reaches its own cleanup
code.

```ts
import { Ui5ODataSeeder, fetchODataMetadata } from 'playwright-sapui5';

test('a product seeded for this test is cleaned up after, pass or fail', async ({ page }) => {
  const metadata = await fetchODataMetadata(`${SERVICE_URL}$metadata`);
  const seeder = await Ui5ODataSeeder.create(page.request, SERVICE_URL);

  const product = await seeder.seed(
    'Products',
    { ProductID: 'P1', Name: 'Widget' },
    { metadata, entityType: 'Product' }, // Product's key (ProductID) is Edm.String - auto-derived
  );

  await page.goto(APP_URL);
  // ... test uses the seeded product ...

  await seeder.cleanup(); // deletes it, most-recently-seeded first
});
```

## Why a delete predicate needs help at all

Deleting an OData V2 entity means `DELETE <entitySet>(<key predicate>)` -
`Products(ProductID='P1')`, or `Orders(OrderID=10,LineNumber=1)` for a composite key. The predicate
has to reuse whatever `create()` actually got back, and the entity type's `$metadata` is the only
place that says which properties make up the key at all.

`seed()` looks the key up in `$metadata` for you and builds the predicate automatically - **but
only when every key property is `Edm.String`**. That's the one case a predicate can be built
without guessing at OData's literal-value syntax for other EDM types (`Edm.Int64` needs an `L`
suffix, `Edm.Decimal` an `M` suffix, `Edm.Guid` a `guid'...'` wrapper, `Edm.DateTime` a
`datetime'...'` wrapper), none of which has been verified against a real SAP Gateway. For anything
else - a composite key, or a key that isn't `Edm.String` - pass `keyPredicate` yourself and build
it from the created entity's own body:

```ts
const product = await seeder.seed(
  'Products',
  { ProductID: 7, Name: 'Widget' },
  { keyPredicate: (created) => `ProductID=${created.ProductID}` }, // Edm.Int32 - unquoted
);
```

`seed()` throws immediately, before any write you'd have to clean up by hand, if it can't
auto-derive a predicate and no `keyPredicate` was given - naming exactly which key property is the
problem.

## Why cleanup order is LIFO

`cleanup()` deletes most-recently-seeded first. The last thing a test seeds is often the thing that
depends on everything seeded before it (a line item depending on its parent order); deleting in
reverse avoids a delete failing because a dependent record still references it.

## Cleanup failures don't throw - they're reported

A failed delete (the record's already gone, a permission problem, whatever) doesn't stop the rest
of cleanup and doesn't throw - it's collected and returned instead, so one already-gone record
doesn't hide failures on the others, and doesn't mask the test's own assertion failure with an
unrelated cleanup error:

```ts
const failures = await seeder.cleanup();
if (failures.length > 0) {
  console.warn('Cleanup left data behind:', failures);
}
```

Every seeded entity is forgotten after `cleanup()` runs, whether its own delete succeeded or
failed - calling `cleanup()` a second time is a no-op, not a retry.

## Sharing a CSRF handshake with `Ui5ODataClient`

If a test already has a `Ui5ODataClient` (for a direct `read()`, say), wrap it instead of
handshaking a second time:

```ts
const client = await Ui5ODataClient.create(page.request, SERVICE_URL);
const seeder = Ui5ODataSeeder.fromClient(client);
```

## API

```ts
class Ui5ODataSeeder {
  static create(
    request: APIRequestContext,
    serviceUrl: string,
    options?: { headers?: Record<string, string> },
  ): Promise<Ui5ODataSeeder>;
  static fromClient(client: Ui5ODataClient): Ui5ODataSeeder;

  seed<T = unknown>(
    entitySet: string,
    data: Record<string, unknown>,
    options?: {
      entityType?: string; // the $metadata entity *type* name, e.g. 'Product'
      metadata?: ODataMetadata;
      keyPredicate?: (created: Record<string, unknown>) => string;
    },
  ): Promise<T>;

  cleanup(): Promise<{ entitySet: string; keyPredicate: string; error: unknown }[]>;
}
```

`seed()` returns exactly what `Ui5ODataClient.create()` returns (the raw, still-`d`-wrapped JSON
body) - existing assertions against that shape keep working unchanged.

## Verified

**Real HTTP for the seed/cleanup mechanics, real live services for the metadata parsing.**
`seed()`/`cleanup()` (predicate derivation, quote-escaping in a string key, LIFO order, the
non-string-key rejection, failed-delete reporting) are verified against the same kind of real local
CSRF-handshake HTTP server [`Ui5ODataClient`](odata-client.md) is - see
[`examples/tests/odata-seeder.spec.ts`](../examples/tests/odata-seeder.spec.ts) for exactly what
that server does and doesn't prove, same caveat as `Ui5ODataClient` itself (no anonymously
accessible public OData V2 service that both requires CSRF protection and permits writes was
available). Separately, the `<Key>` parsing this all depends on is checked against two real, free,
public `$metadata` documents: Northwind V2's `Product` (`Edm.Int32` key - the case that's rejected)
and TripPin V4's `Person` (`Edm.String` key - the case that's auto-derived).

## Related

- [docs/odata-client.md](odata-client.md) - the lower-level `create()`/`update()`/`delete()`
  primitives this is built on
- [docs/odata-metadata.md](odata-metadata.md) - `fetchODataMetadata()`, and what else `$metadata`
  parsing is used for
