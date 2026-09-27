import { test, expect } from '../../src';
import { fetchODataMetadata, mockODataCollection, validateAgainstODataMetadata } from '../../src';

// Two real, free, public OData services - used specifically because they're genuinely different
// (V2 vs V4) and, unlike every other test in this repo, this feature's whole point is to check
// mock data against a *real service's own published contract*, so a real $metadata document is
// the thing under test here, not incidental. See docs/odata-metadata.md.
const NORTHWIND_V2_METADATA_URL = 'https://services.odata.org/V2/Northwind/Northwind.svc/$metadata';
const TRIPPIN_V4_METADATA_URL = 'https://services.odata.org/V4/TripPinServiceRW/$metadata';

/**
 * Demonstrates `fetchODataMetadata`/`validateAgainstODataMetadata` - catching a mock that's
 * silently drifted from a real OData service's contract (most commonly a typo'd or renamed
 * property) before it ever reaches the app, instead of as a confusing binding failure deep inside
 * it. See docs/odata-metadata.md.
 */
test.describe('OData $metadata validation', () => {
  test('parses a real V2 $metadata document and validates data against it', async () => {
    const metadata = await fetchODataMetadata(NORTHWIND_V2_METADATA_URL);
    expect(metadata.entityTypes.has('Product')).toBe(true);

    // Real, correctly-shaped data - including UnitPrice as a quoted string, which is exactly how
    // OData V2 serializes Edm.Decimal in JSON. Must not be flagged.
    expect(
      validateAgainstODataMetadata(metadata, 'Product', {
        ProductID: 1,
        ProductName: 'Chai',
        UnitPrice: '18.0000',
        Discontinued: false,
      }),
    ).toEqual([]);

    // A typo'd property name - the exact bug this feature exists to catch.
    const typoIssues = validateAgainstODataMetadata(metadata, 'Product', {
      ProductID: 1,
      ProductNmae: 'Chai',
    });
    expect(typoIssues).toHaveLength(1);
    expect(typoIssues[0].message).toContain('"ProductNmae" is not a property of "Product"');
    expect(typoIssues[0].message).toContain('ProductName'); // the real name, in the suggestion list

    // An unambiguous type mismatch (a string where the schema says Edm.Boolean).
    expect(
      validateAgainstODataMetadata(metadata, 'Product', { ProductID: 1, Discontinued: 'yes' }),
    ).toHaveLength(1);

    // A misspelled entity type name lists the real ones, rather than just failing silently.
    const badType = validateAgainstODataMetadata(metadata, 'Prodcut', { ProductID: 1 });
    expect(badType).toHaveLength(1);
    expect(badType[0].message).toContain('Known entity types:');
  });

  test('mockODataCollection throws synchronously when data does not match the real schema', async ({
    page,
  }) => {
    const metadata = await fetchODataMetadata(NORTHWIND_V2_METADATA_URL);

    // Fails before the route is even registered - at test-setup time, naming the exact property,
    // rather than surfacing later as an OData binding error somewhere inside the app.
    await expect(
      mockODataCollection(page, '**/Products', [{ ProductID: 1, ProductNmae: 'Chai' }], {
        metadata,
        entityType: 'Product',
      }),
    ).rejects.toThrow(/ProductNmae/);

    // Correctly-shaped data mocks normally.
    await mockODataCollection(page, '**/Products', [{ ProductID: 1, ProductName: 'Chai' }], {
      metadata,
      entityType: 'Product',
    });
  });

  test('parses a real V4 $metadata document, including Collection(...) properties', async () => {
    const metadata = await fetchODataMetadata(TRIPPIN_V4_METADATA_URL);
    const person = metadata.entityTypes.get('Person');
    expect(person).toBeTruthy();
    expect(person!.properties.find((p) => p.name === 'Emails')?.type).toBe(
      'Collection(Edm.String)',
    );

    expect(
      validateAgainstODataMetadata(metadata, 'Person', {
        UserName: 'russellwhyte',
        FirstName: 'Russell',
        Emails: ['Russell@example.com'],
      }),
    ).toEqual([]);

    // A Collection(...) property given a non-array value is an unambiguous mismatch.
    const badCollection = validateAgainstODataMetadata(metadata, 'Person', {
      UserName: 'x',
      Emails: 'not-an-array',
    });
    expect(badCollection).toHaveLength(1);
    expect(badCollection[0].message).toContain('Collection(...)');
  });
});
