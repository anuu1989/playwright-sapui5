import type { Page } from '@playwright/test';
import { Ui5Locator, Ui5Page } from '../../src';
import { ProductDetailPage } from './ProductDetailPage';

/** The product list shown after selecting a category from `CartPage`. */
export class CategoryPage extends Ui5Page {
  constructor(page: Page) {
    super(page);
  }

  // A stable, view-scoped id suffix - even though the *text* this shows changes per category
  // ("Laptops", "Printers", ...), the *id* doesn't, which is exactly the case where preferring
  // `id()` over `text()` pays off (see docs/core-concepts.md). Note the suffix is scoped to
  // `category--page-title`, not just `page-title`: SAPUI5's NavContainer keeps the *previous*
  // page in the DOM after a transition (hidden, for smooth back-navigation) rather than removing
  // it, so the home view's own `...homeView--page-title` is still a live match for the shorter
  // suffix - `id()`'s "ends with" matching happily finds both, and Playwright's strict mode then
  // (correctly) refuses to act on two elements at once. See docs/troubleshooting.md for more on
  // this class of gotcha.
  get title(): Ui5Locator {
    return this.id('category--page-title').as('Category page title');
  }

  get backButton(): Ui5Locator {
    return this.id('category--page-navButton').as('Back to categories button');
  }

  /**
   * Every product row currently rendered in this category's list - a `controlType(...)` locator
   * with no further filter, so it matches *all* of them at once. `examples/tests/data-driven.spec.ts`
   * uses this via `.count()` to assert "at least one product exists," without caring which
   * specific products they are - compare that to `product(name)` just below, which finds exactly
   * one named product.
   */
  get products(): Ui5Locator {
    return this.controlType('sap.m.ObjectListItem').as('Products in this category');
  }

  product(name: string): Ui5Locator {
    return this.text(name, { controlType: 'sap.m.ObjectListItem' }).as(`Product: ${name}`);
  }

  /**
   * Clicks a named product and returns a Page Object for the detail pane it reveals. This is the
   * middle link in a three-step composed chain: `CartPage.selectCategory()` returns a
   * `CategoryPage`, this returns a `ProductDetailPage` - see
   * `examples/tests/product-detail.spec.ts` for the full chain in use, and
   * docs/page-objects.md#composing-page-objects for the pattern explained.
   */
  async openProduct(name: string): Promise<ProductDetailPage> {
    await this.product(name).click();
    return new ProductDetailPage(this.page);
  }

  /** Navigates back to the top-level category list (`CartPage`'s category list). */
  async goBack(): Promise<void> {
    await this.backButton.click();
  }
}
