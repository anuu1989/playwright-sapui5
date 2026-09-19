import { test, expect } from '../../src';
import { mockODataCollection, mockODataEntity, mockODataError } from '../../src';

/**
 * Demonstrates the OData mocking helpers - `mockODataCollection`, `mockODataEntity`,
 * `mockODataError`. See docs/odata-mocking.md, including an important scope note repeated here:
 * this repo's own example apps use static JSON, not a real OData service, so what's verified
 * below is the envelope-building and interception mechanics themselves (against a real, live
 * page, via a real `fetch()` call) - not integration with a real `sap.ui.model.odata.*Model`.
 * Wiring these into your own OData-backed app is a documented pattern, not something this
 * specific test can prove end-to-end.
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
});
