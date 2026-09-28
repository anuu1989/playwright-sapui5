import { createServer, type Server } from 'node:http';
import { test, expect } from '../../src';
import { Ui5ODataClient, Ui5ODataSeeder, fetchODataMetadata, parseODataMetadata } from '../../src';

// Same real, free, public services odata-metadata.spec.ts uses - here specifically because their
// key types genuinely differ: TripPin's Person is keyed by a single Edm.String (UserName), the
// safe case Ui5ODataSeeder can auto-derive a delete predicate for; Northwind's Product is keyed by
// Edm.Int32 (ProductID), the case it deliberately refuses to guess at. See docs/odata-seeder.md.
const NORTHWIND_V2_METADATA_URL = 'https://services.odata.org/V2/Northwind/Northwind.svc/$metadata';
const TRIPPIN_V4_METADATA_URL = 'https://services.odata.org/V4/TripPinServiceRW/$metadata';

test.describe('OData $metadata key parsing', () => {
  test('captures <Key> property names from real V2 and V4 $metadata', async () => {
    const northwind = await fetchODataMetadata(NORTHWIND_V2_METADATA_URL);
    expect(northwind.entityTypes.get('Product')?.keyPropertyNames).toEqual(['ProductID']);
    expect(
      northwind.entityTypes.get('Product')?.properties.find((p) => p.name === 'ProductID')?.type,
    ).toBe('Edm.Int32');

    const trippin = await fetchODataMetadata(TRIPPIN_V4_METADATA_URL);
    expect(trippin.entityTypes.get('Person')?.keyPropertyNames).toEqual(['UserName']);
    expect(
      trippin.entityTypes.get('Person')?.properties.find((p) => p.name === 'UserName')?.type,
    ).toBe('Edm.String');
  });
});

/**
 * Verifies Ui5ODataSeeder against a real local HTTP server implementing the same CSRF handshake as
 * odata-client.spec.ts - page.route() can't intercept Ui5ODataClient's APIRequestContext calls
 * (see that file's own comment), so this is a real, if local, server, extended here to track
 * multiple entities so LIFO cleanup order is actually observable.
 */
test.describe('Ui5ODataSeeder', () => {
  let server: Server;
  let baseUrl: string;
  let deleteOrder: string[];

  test.beforeEach(async () => {
    deleteOrder = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const path = decodeURIComponent((req.url ?? '').replace(/^\//, ''));

        if (req.method === 'GET' && req.headers['x-csrf-token'] === 'Fetch') {
          res.writeHead(200, { 'x-csrf-token': 'seeder-token' });
          res.end('{}');
          return;
        }
        const isWrite = req.method === 'POST' || req.method === 'DELETE';
        if (isWrite && req.headers['x-csrf-token'] !== 'seeder-token') {
          res.writeHead(403, { 'x-csrf-token': 'Required' });
          res.end();
          return;
        }
        if (req.method === 'POST') {
          const data = JSON.parse(body || '{}');
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ d: data }));
          return;
        }
        if (req.method === 'DELETE') {
          deleteOrder.push(path);
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  });

  test.afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('auto-derives a string-key delete predicate from real $metadata and cleans up LIFO', async ({
    request,
  }) => {
    // A tiny, self-contained $metadata with one Edm.String-keyed entity type - the parsing itself
    // (Product/Person, Int32/String) is already proven against real services above; this test is
    // about seed()/cleanup()'s own behavior, which only needs a deterministic schema.
    const metadata = parseODataMetadata(
      '<Schema><EntityType Name="Product"><Key><PropertyRef Name="ProductID"/></Key>' +
        '<Property Name="ProductID" Type="Edm.String" Nullable="false"/>' +
        '<Property Name="Name" Type="Edm.String"/></EntityType></Schema>',
    );

    const seeder = await Ui5ODataSeeder.create(request, baseUrl);
    const first = await seeder.seed<{ d: { ProductID: string } }>(
      'Products',
      { ProductID: 'P1', Name: 'Widget' },
      { metadata, entityType: 'Product' },
    );
    expect(first.d.ProductID).toBe('P1');
    const second = await seeder.seed<{ d: { ProductID: string } }>(
      'Products',
      { ProductID: "P2's", Name: 'Gadget' }, // embedded single-quote - must be escaped in the predicate
      { metadata, entityType: 'Product' },
    );
    expect(second.d.ProductID).toBe("P2's");

    const failures = await seeder.cleanup();
    expect(failures).toEqual([]);
    // Most-recently-seeded first.
    expect(deleteOrder).toEqual([`Products(ProductID='P2''s')`, `Products(ProductID='P1')`]);

    // A second cleanup() is a no-op - nothing left to delete, no error.
    expect(await seeder.cleanup()).toEqual([]);
  });

  test('rejects auto-derivation for a non-Edm.String key and requires an explicit keyPredicate', async ({
    request,
  }) => {
    const metadata = parseODataMetadata(
      '<Schema><EntityType Name="Product"><Key><PropertyRef Name="ProductID"/></Key>' +
        '<Property Name="ProductID" Type="Edm.Int32" Nullable="false"/></EntityType></Schema>',
    );
    const seeder = await Ui5ODataSeeder.create(request, baseUrl);

    await expect(
      seeder.seed('Products', { ProductID: 7 }, { metadata, entityType: 'Product' }),
    ).rejects.toThrow(/not Edm\.String/);

    // The explicit keyPredicate escape hatch works for exactly this case.
    const created = await seeder.seed<{ d: { ProductID: number } }>(
      'Products',
      { ProductID: 7 },
      { keyPredicate: (body) => `ProductID=${body.ProductID}` },
    );
    expect(created.d.ProductID).toBe(7);
    await seeder.cleanup();
    expect(deleteOrder).toEqual(['Products(ProductID=7)']);
  });

  test('reports a failed delete instead of throwing, and still forgets the entity', async ({
    request,
  }) => {
    const client = await Ui5ODataClient.create(request, baseUrl);
    const seeder = Ui5ODataSeeder.fromClient(client);

    await seeder.seed(
      'Products',
      { ProductID: 'gone-already' },
      {
        keyPredicate: () => `ProductID='does-not-exist'`,
      },
    );
    // Make the server 404 every subsequent DELETE, simulating the record already being gone.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createServer((_req, res) => res.writeHead(404).end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const failures = await seeder.cleanup();
    expect(failures).toHaveLength(1);
    expect(failures[0].keyPredicate).toBe(`ProductID='does-not-exist'`);
    expect(failures[0].error).toBeInstanceOf(Error);
    // Forgotten regardless of the failure - a retry wouldn't re-attempt it.
    expect(await seeder.cleanup()).toEqual([]);
  });
});
