import { test, expect } from '../../src';
import { maskDynamicUi5Content } from '../../src';

/**
 * Demonstrates `maskDynamicUi5Content` - finding controls whose content is inherently time-based,
 * so they can be masked out of a visual regression screenshot instead of causing a flaky diff.
 * See docs/visual-testing.md#masking-dynamic-content.
 *
 * Verified end to end against a real SAPUI5 runtime (the same served-from-a-real-origin harness
 * pattern the `$batch` test in `examples/tests/odata-mocking.spec.ts` uses - UI5 won't bootstrap
 * from `page.setContent()`), because the whole point of this feature is reading a control's real
 * binding metadata, not guessing from rendered text - proving that needs a real `sap.ui.model`
 * binding actually attached to a real control, not a static demo page.
 */
test('finds a date/time-bound control, and only that one', async ({ page }) => {
  await page.route('https://ui5.sap.com/__mask_harness__', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!DOCTYPE html><html><head>
<script id="sap-ui-bootstrap" src="https://ui5.sap.com/resources/sap-ui-core.js"
  data-sap-ui-libs="sap.m" data-sap-ui-async="true"></script>
</head><body><div id="content"></div></body></html>`,
    }),
  );
  await page.goto('https://ui5.sap.com/__mask_harness__');
  await page.waitForFunction(() => (window as any).sap?.ui?.getCore, null, { timeout: 40000 });

  const ids = await page.evaluate(
    () =>
      new Promise<{ dateTextId: string; plainTextId: string; literalDateTextId: string }>(
        (resolve) => {
          (window as any).sap.ui.require(
            [
              'sap/m/Text',
              'sap/m/VBox',
              'sap/ui/model/json/JSONModel',
              'sap/ui/model/type/DateTime',
            ],
            (Text: any, VBox: any, JSONModel: any, DateTimeType: any) => {
              const model = new JSONModel({
                createdAt: '2024-01-01T00:00:00Z',
                plainLabel: 'Hello',
              });

              // Bound WITH a real DateTime binding type - the thing this feature should find.
              const dateText = new Text('dateText', {
                text: { path: '/createdAt', type: new DateTimeType() },
              });
              dateText.setModel(model);

              // Bound WITHOUT a type - a plain string binding - should not be flagged.
              const plainText = new Text('plainText', { text: { path: '/plainLabel' } });
              plainText.setModel(model);

              // A literal string that merely *looks* like a date, no binding at all - proves this
              // reads binding metadata rather than guessing from rendered text.
              const literalDateText = new Text('literalDateText', { text: '2024-01-01' });

              new VBox({ items: [dateText, plainText, literalDateText] }).placeAt('content');

              setTimeout(
                () =>
                  resolve({
                    dateTextId: dateText.getId(),
                    plainTextId: plainText.getId(),
                    literalDateTextId: literalDateText.getId(),
                  }),
                200,
              );
            },
          );
        },
      ),
  );

  const masked = await maskDynamicUi5Content(page);
  expect(masked).toHaveLength(1);

  const maskedIds = await masked[0].evaluateAll((els) => els.map((el) => el.id));
  expect(maskedIds).toEqual([ids.dateTextId]);
  expect(maskedIds).not.toContain(ids.plainTextId);
  expect(maskedIds).not.toContain(ids.literalDateTextId);

  // This is the whole point: the real usage is passing `masked` straight to Playwright's own
  // `mask` option -
  //   await expect(page).toHaveScreenshot('dashboard.png', { mask: masked });
  // - not asserted here as an actual screenshot comparison, since (like
  // examples/tests/visual.spec.ts) a committed baseline is sensitive to the OS that generated it;
  // this test's job is proving `masked` resolves to the right elements, which the assertions
  // above already do.
});
