import type { Page } from '@playwright/test';
import { Ui5Locator, Ui5Page } from '../../src';

/**
 * The product detail pane shown alongside the category list once a product is selected
 * (SAPUI5's `FlexibleColumnLayout` shows both at once - this isn't a full-page navigation).
 */
export class ProductDetailPage extends Ui5Page {
  constructor(page: Page) {
    super(page);
  }

  /**
   * A method, not a `get` accessor, because the product's title text is the only thing that
   * identifies which product's detail pane you mean - there's no stable id to reach for here
   * (see `CartPage.product()`'s comment on why this app's individual product controls don't have
   * one worth relying on).
   */
  title(name: string): Ui5Locator {
    return this.text(name, { controlType: 'sap.m.Title' }).as(`Product title: ${name}`);
  }

  get addToCartButton(): Ui5Locator {
    return this.text('Add to Cart', { controlType: 'sap.m.Button' }).as('Add to Cart button');
  }

  async addToCart(): Promise<void> {
    await this.addToCartButton.click();
  }
}
