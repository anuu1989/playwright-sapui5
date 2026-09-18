# Page Objects

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) first -
> in particular [classes](typescript-for-beginners.md#classes) and
> [getters](typescript-for-beginners.md#getters), which this whole pattern is built on.

`Ui5Page` is a small base class for the [Page Object
pattern](https://playwright.dev/docs/pom): one class per screen/view of your app, holding its
locators and the actions a test can perform on it, so tests read like user stories instead of
strings of raw selectors.

## Basic shape

```ts
import type { Page } from '@playwright/test';
import { Ui5Page } from 'playwright-sapui5';

export class LoginPage extends Ui5Page {
  async open() {
    await this.goto('https://example.com/login');
  }

  get usernameInput() {
    return this.controlType('sap.m.Input', { name: 'username' });
  }

  get passwordInput() {
    return this.controlType('sap.m.Input', { name: 'password' });
  }

  get loginButton() {
    return this.text('Log On', { controlType: 'sap.m.Button' });
  }

  async loginAs(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
```

```ts
import { test, expect } from 'playwright-sapui5';
import { LoginPage } from '../pages/LoginPage';

test('valid credentials log the user in', async ({ page }) => {
  const login = new LoginPage(page);
  await login.open();
  await login.loginAs('demo', 'demo');

  await expect(page.getByText('Welcome')).toBeVisible();
});
```

## What `Ui5Page` gives you

- **Protected locator helpers** - `this.id(...)`, `this.controlType(...)`, `this.bindingPath(...)`,
  `this.text(...)`, `this.css(...)` - thin wrappers around the matching `Ui5Locator` static
  factories, scoped to `this.page`, so you don't have to pass `page` around inside the class.
- **`this.goto(url, options?)`** - navigates, then waits for the SAPUI5 runtime to bootstrap
  (`waitForUi5Core`), then waits for the app to settle (`waitForUi5Ready`). See
  [docs/auto-wait.md](auto-wait.md) for exactly what that means and why the ordering matters.
- **`this.waitForUi5Ready(options?)`** - re-usable on its own, e.g. after an in-app action that
  you expect to trigger loading (without a full navigation).

## Getters vs. methods

Use a **getter** for a locator (cheap, doesn't act, just describes where to find something):

```ts
get saveButton() {
  return this.controlType('sap.m.Button', { text: 'Save' });
}
```

Use a **method** for anything that performs an action, especially multi-step ones:

```ts
async save() {
  await this.saveButton.click();
  await this.page.waitForURL(/saved/);
}
```

This mirrors how the framework's own example Page Object,
[`examples/pages/CartPage.ts`](../examples/pages/CartPage.ts), is structured - read it alongside
this guide for a complete, working reference.

## One Page Object per screen, not per app

Resist the urge to put every locator in your app into one giant Page Object. Structure them the
way your app's own views/routes are structured - a `LoginPage`, a `ProductListPage`, a
`CartPage`, etc. - so each class stays small and each test only depends on the Page Objects it
actually needs.

## Parameterized locators for repeated elements

For lists, tables, or anything that repeats, write a **method that returns a locator** rather
than a fixed getter per item:

```ts
export class ProductListPage extends Ui5Page {
  product(name: string) {
    return this.text(name, { controlType: 'sap.m.ObjectListItem' });
  }

  async selectProduct(name: string) {
    await this.product(name).click();
  }
}
```

```ts
await productList.selectProduct('Astro Laptop 1516');
await expect(await productList.product('Astro Laptop 1516').resolve()).toBeVisible();
```

## Composing Page Objects

A method on one Page Object can return an instance of another, to model navigation between
screens explicitly:

```ts
export class LoginPage extends Ui5Page {
  async loginAs(username: string, password: string): Promise<HomePage> {
    // ... fill in credentials, click login ...
    return new HomePage(this.page);
  }
}
```

```ts
const home = await new LoginPage(page).loginAs('demo', 'demo');
await home.openCart();
```

This keeps tests fluent (`await loginPage.loginAs(...).openCart()`-style chains) while making the
navigation your test performs explicit and typed.

## Skipping Page Objects entirely

For a quick script, a one-off test, or exploratory work, you don't have to use `Ui5Page` at all -
`ui5(page)` works standalone (see [docs/locators.md](locators.md)). Reach for a Page Object once
you notice you're repeating the same locators or action sequences across more than one test.
