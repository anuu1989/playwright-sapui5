import type { Page } from '@playwright/test';
import { Ui5Locator, Ui5Page } from '../../src';
import { CategoryPage } from './CategoryPage';

const APP_URL = 'https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html';

/**
 * Page Object for SAP's public "Shopping Cart" SAPUI5 demo app - the same app the SAPUI5 team
 * uses in its own testing tutorials. Used by the example tests in `examples/tests/` to prove
 * out the framework end-to-end against a real, live SAPUI5 application (UI5 version 1.152).
 */
export class CartPage extends Ui5Page {
  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.goto(APP_URL);
  }

  /** Primary strategy: the field's stable id. Fallback: its control type, in case the id ever changes. */
  get searchField(): Ui5Locator {
    return this.id('searchField')
      .fallback({ by: 'controlType', controlType: 'sap.m.SearchField' })
      .as('Search field');
  }

  get categoryList(): Ui5Locator {
    return this.controlType('sap.m.List').as('Category list');
  }

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

  /** Clicks a category and returns a Page Object for the product list it navigates to - see
   * docs/page-objects.md#composing-page-objects. */
  async selectCategory(name: string): Promise<CategoryPage> {
    await this.category(name).click();
    return new CategoryPage(this.page);
  }
}
