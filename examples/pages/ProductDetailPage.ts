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
