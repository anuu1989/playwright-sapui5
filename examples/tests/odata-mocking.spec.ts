import { test, expect } from '../../src';
import { mockODataBatch, mockODataCollection, mockODataEntity, mockODataError } from '../../src';

/**
 * Demonstrates the OData mocking helpers - `mockODataCollection`, `mockODataEntity`,
 * `mockODataError`, `mockODataBatch`. See docs/odata-mocking.md.
 *
 * Scope note: the first three tests verify the envelope-building and interception mechanics
 * themselves (against a real, live page, via a real `fetch()` call), because this repo's own
 * example apps serve static JSON rather than running a real OData service. The `$batch` test at
 * the bottom goes further and is verified end to end against a **real
 * `sap.ui.model.odata.v2.ODataModel`** - because a hand-built multipart response is exactly the
 * kind of thing that looks right and fails to parse, so nothing short of UI5's own parser
 * consuming it would actually prove it works.
 */
test.describe('OData mocking', () => {
  test('mockODataCollection wraps data in the OData V2 envelope by default', async ({ page }) => {
    await mockODataCollection(page, '**/Products', [
      { ProductID: '1', Name: 'Widget' },
      { ProductID: '2', Name: 'Gadget' },
    ]);
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    const result = await page.evaluate(() => fetch('/Products').then((r) => r.json()));

    expect(result).toEqual({
      d: {
        results: [
          { ProductID: '1', Name: 'Widget' },
          { ProductID: '2', Name: 'Gadget' },
        ],
      },
    });
  });

  test('mockODataCollection supports the OData V4 envelope', async ({ page }) => {
    await mockODataCollection(page, '**/ProductsV4', [{ ProductID: '3', Name: 'Thing' }], {
      version: 'v4',
    });
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    const result = await page.evaluate(() => fetch('/ProductsV4').then((r) => r.json()));

    expect(result).toEqual({ value: [{ ProductID: '3', Name: 'Thing' }] });
  });

  test('mockODataEntity wraps a single entity', async ({ page }) => {
    await mockODataEntity(page, "**/Products('1')", { ProductID: '1', Name: 'Widget' });
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    const result = await page.evaluate(() => fetch("/Products('1')").then((r) => r.json()));

    expect(result).toEqual({ d: { ProductID: '1', Name: 'Widget' } });
  });

  test('mockODataError simulates a failed request with a proper OData error body', async ({
    page,
  }) => {
    await mockODataError(page, '**/Fail', {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Product name is required',
    });
    await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

    const result = await page.evaluate(async () => {
      const response = await fetch('/Fail');
      return { status: response.status, body: await response.json() };
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: { lang: 'en', value: 'Product name is required' },
      },
    });
  });

  test('mockODataBatch is parsed by a real ODataModel with useBatch enabled', async ({ page }) => {
    // A real Fiori app doesn't issue the tidy `GET /Products` the tests above intercept:
    // `sap.ui.model.odata.v2.ODataModel` defaults to `useBatch: true`, so it sends ONE POST to
    // `/$batch` carrying a multipart MIME document, and expects a multipart response back. That
    // format is strict (CRLFs, boundary markers, an embedded status line and headers per part),
    // which is why this is worth a helper - and why it's verified against UI5's own parser rather
    // than by eyeballing the bytes.
    await mockODataBatch(page, '**/svc/$batch', [
      {
        data: [
          {
            __metadata: { uri: "svc/Products('HT-1')", type: 'NS.Product' },
            ProductID: 'HT-1',
            Name: 'Mocked Notebook',
          },
          {
            __metadata: { uri: "svc/Products('HT-2')", type: 'NS.Product' },
            ProductID: 'HT-2',
            Name: 'Mocked Monitor',
          },
        ],
      },
    ]);

    // The model fetches $metadata separately (not through the batch), so that needs mocking too.
    await page.route('**/svc/$metadata', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
 <edmx:DataServices xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" m:DataServiceVersion="2.0">
  <Schema Namespace="NS" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
   <EntityType Name="Product"><Key><PropertyRef Name="ProductID"/></Key>
    <Property Name="ProductID" Type="Edm.String" Nullable="false"/>
    <Property Name="Name" Type="Edm.String"/>
   </EntityType>
   <EntityContainer Name="Container" m:IsDefaultEntityContainer="true">
    <EntitySet Name="Products" EntityType="NS.Product"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`,
      }),
    );

    // A minimal page that boots real SAPUI5, served from a real https origin - UI5 won't
    // bootstrap from `page.setContent()` (it has no origin to resolve its resources against), and
    // serving it from ui5.sap.com itself keeps everything same-origin.
    await page.route('https://ui5.sap.com/__batch_harness__', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html><html><head>
<script id="sap-ui-bootstrap" src="https://ui5.sap.com/resources/sap-ui-core.js"
  data-sap-ui-libs="sap.m" data-sap-ui-async="true"></script>
</head><body></body></html>`,
      }),
    );
    await page.goto('https://ui5.sap.com/__batch_harness__');
    await page.waitForFunction(() => (window as any).sap?.ui?.getCore, null, { timeout: 40000 });

    const result = await page.evaluate(
      () =>
        new Promise<{ count: number; names: string[] }>((resolve, reject) => {
          (window as any).sap.ui.require(
            ['sap/ui/model/odata/v2/ODataModel'],
            (ODataModel: any) => {
              const model = new ODataModel({ serviceUrl: '/svc/', useBatch: true });
              model.metadataLoaded().then(() => {
                model.read('/Products', {
                  success: (data: any) =>
                    resolve({
                      count: data.results.length,
                      names: data.results.map((row: any) => row.Name),
                    }),
                  error: () => reject(new Error('read failed')),
                });
              });
            },
          );
        }),
    );

    // UI5's own batch parser consumed the response and produced real model entities.
    expect(result.count).toBe(2);
    expect(result.names).toEqual(['Mocked Notebook', 'Mocked Monitor']);
  });
});
