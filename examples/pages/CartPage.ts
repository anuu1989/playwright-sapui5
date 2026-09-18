import type { Page } from '@playwright/test';
import { Ui5Locator, Ui5Page } from '../../src';
import { CategoryPage } from './CategoryPage';

/**
 * Page Object for SAP's public "Shopping Cart" SAPUI5 demo app - the same app the SAPUI5 team
 * uses in its own testing tutorials. Used by the example tests in `examples/tests/` to prove
 * out the framework end-to-end against a real, live SAPUI5 application (UI5 version 1.152).
 *
 * `extends Ui5Page` is what makes `this.id(...)`, `this.controlType(...)`, `this.text(...)`, and
 * `this.goto(...)` available below, without importing or constructing anything extra - they're
 * inherited straight from the base class (`src/core/Ui5Page.ts`). See docs/page-objects.md for
 * the pattern in general.
 */
export class CartPage extends Ui5Page {
  // This constructor doesn't actually need to exist - `extends Ui5Page` would inherit `Ui5Page`'s
  // own `constructor(page: Page)` automatically if this one were deleted. It's written out
  // explicitly here (and in the other example Page Objects) mainly for clarity while reading the
  // code for the first time; both versions behave identically.
  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    // Navigates to Playwright's configured `baseURL` (see playwright.config.ts) rather than a
    // hardcoded address, so this whole suite can be pointed at a different app via the BASE_URL
    // env var without touching any Page Object - see docs/multi-environment-config.md. The empty
    // string matters: `goto('/')` would resolve to the *domain root*, discarding baseURL's own
    // path (this app's baseURL isn't served from a domain root) - `goto('')` resolves to
    // baseURL exactly, unchanged.
    await this.goto('');
  }

  /**
   * Primary strategy: the field's stable id. Fallback: its control type, in case the id ever
   * changes. Written as a `get` accessor (see docs/typescript-for-beginners.md#getters) rather
   * than a plain method, so it reads at the call site (`cart.searchField.fill(...)`) like a
   * property, not a function call - matching how you'd talk about it ("the page's search field"),
   * even though under the hood it builds a brand new `Ui5Locator` every time it's accessed.
   */
  get searchField(): Ui5Locator {
    return this.id('searchField')
      .fallback({ by: 'controlType', controlType: 'sap.m.SearchField' })
      .as('Search field');
  }

  get categoryList(): Ui5Locator {
    return this.controlType('sap.m.List').as('Category list');
  }

  /**
   * Unlike `searchField`/`categoryList` above, this is a regular method, not a `get` accessor -
   * because it needs a parameter (`name`). Getters in TypeScript/JavaScript can never take
   * arguments (`cart.category('Laptops')` wouldn't be valid syntax for a getter called
   * `category`), so anything parameterized has to be written as an ordinary method instead - see
   * docs/page-objects.md#parameterized-locators-for-repeated-elements.
   */
  category(name: string): Ui5Locator {
    return this.text(name, { controlType: 'sap.m.StandardListItem' }).as(`Category: ${name}`);
  }

  // Deliberately locates products by their visible title, not by id. This list's items get
  // SAPUI5-generated ids with a global auto-increment prefix (e.g. `__item0-...`) that can
  // differ between sessions depending on how many other auto-id'd controls loaded first -
  // hardcoding one of those ids made this exact locator flaky during development. See
  // docs/troubleshooting.md#unstable-generated-ids.
  product(name: string): Ui5Locator {
    return this.text(name, { controlType: 'sap.m.ObjectListItem' }).as(`Product: ${name}`);
  }

  /** The "Add to cart" button (cart icon) on the first promoted item on the welcome pane. */
  get firstAddToCartButton(): Ui5Locator {
    return this.controlType('sap.m.Button', { icon: 'sap-icon://cart-3' }).as('Add to cart button');
  }

  /**
   * Clicks a category and returns a Page Object for the product list it navigates to - see
   * docs/page-objects.md#composing-page-objects. Notice the return type is `Promise<CategoryPage>`,
   * not `Promise<void>`: a test can either ignore the return value (`await cart.selectCategory('Laptops');`,
   * as `examples/tests/cart.spec.ts` does) or capture it to keep going
   * (`const category = await cart.selectCategory('Laptops');`, as `examples/tests/product-detail.spec.ts`
   * does) - both are valid, TypeScript doesn't force you to use a function's return value.
   */
  async selectCategory(name: string): Promise<CategoryPage> {
    await this.category(name).click();
    return new CategoryPage(this.page);
  }
}
