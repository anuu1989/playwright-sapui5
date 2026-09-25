import { test, expect } from '../../src';
import { ui5, findUi5Frame, waitForUi5Core, waitForUi5 } from '../../src';

// A minimal stand-in for a Fiori Launchpad shell: a plain host page that embeds a real SAPUI5
// app inside an <iframe>, the same way a launchpad embeds each tile's target app. There's no
// public, stable Fiori Launchpad demo to point a test at directly, so this test builds the
// smallest possible shell itself, via `page.setContent()`, and embeds the same real, live cart
// demo the rest of this repo's examples use - see docs/cross-frame.md for why this is a faithful
// stand-in for the real thing (the mechanism this test exercises - `addInitScript` reaching into
// iframes, `Ui5Bridge`/`Ui5Locator` working against a `Frame` - doesn't care whether the shell
// around the iframe happens to be a real launchpad or three lines of HTML).
const APP_URL = 'https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html';
const SHELL_HTML = `
  <html>
    <body>
      <h1>Shell</h1>
      <iframe
        id="appFrame"
        src="${APP_URL}"
        style="width:1200px;height:800px;border:1px solid black;"
      ></iframe>
    </body>
  </html>
`;

/**
 * Demonstrates testing a SAPUI5 app embedded in an iframe - the pattern used by Fiori Launchpad
 * and similar "shell" apps. See docs/cross-frame.md for the full picture: `page.addInitScript()`
 * (used internally by `Ui5Bridge.ensure()`) reaches into every iframe automatically, and every
 * `Ui5Target`-accepting piece of this framework (`Ui5Bridge`, `waitForUi5`/`waitForUi5Core`,
 * `Ui5Locator`'s static factories, and the `ui5(...)` helper) accepts a Playwright `Frame`
 * anywhere it accepts a `Page`.
 */
test.describe('Cross-iframe (Fiori Launchpad-style) support', () => {
  test('finds the embedded app frame and interacts with controls inside it', async ({ page }) => {
    await page.setContent(SHELL_HTML);

    // The shell's own main document is plain HTML here (no SAPUI5 of its own) - in a real Fiori
    // Launchpad, the shell itself *is* a SAPUI5 app, which is exactly why `findUi5Frame` only
    // ever looks at frames other than `page.mainFrame()`: it's specifically hunting for the
    // *embedded* app's own runtime, not the shell's.
    const appFrame = await findUi5Frame(page, { timeout: 30000 });
    expect(appFrame.url()).toContain('demokit/cart');

    // From here on, `appFrame` (a Playwright `Frame`) is used exactly like a `Page` everywhere
    // this framework accepts one.
    await waitForUi5Core(appFrame, { timeout: 30000 });
    await waitForUi5(appFrame, { timeout: 15000 });

    const categoryList = ui5(appFrame).controlType('sap.m.List');
    await expect(await categoryList.resolve()).toBeVisible();

    await ui5(appFrame).text('Laptops', { controlType: 'sap.m.StandardListItem' }).click();

    // Clicking a category inside the iframe navigates *within that iframe* - the outer shell page
    // never navigates at all. The product only became visible after that in-frame navigation, so
    // this also confirms `Ui5Locator`'s auto-wait is polling the frame's own control tree, not
    // the (SAPUI5-free) shell page's. `controlType` narrows to the product row itself, not its
    // nested title text span - the same ambiguity `examples/pages/CartPage.ts`'s `product()`
    // getter documents and avoids the same way.
    const product = ui5(appFrame).text('Astro Laptop 1516', {
      controlType: 'sap.m.ObjectListItem',
    });
    await expect(await product.resolve()).toBeVisible();
  });

  test('findUi5Frame narrows candidates with a predicate', async ({ page }) => {
    await page.setContent(SHELL_HTML);

    const appFrame = await findUi5Frame(page, {
      timeout: 30000,
      predicate: (frame) => frame.url().includes('demokit/cart'),
    });
    expect(appFrame.url()).toContain('demokit/cart');
  });
});
