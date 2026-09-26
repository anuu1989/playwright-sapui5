import { test, expect } from '../../src';
import { Ui5I18n, Ui5MessageToast, Ui5Messages } from '../../src';
import { CartPage } from '../pages/CartPage';

/**
 * Demonstrates `Ui5MessageToast` (transient toasts, recorded so they survive their own ~3s
 * auto-hide) and `Ui5Messages` (SAPUI5's central message model - validation and backend errors).
 * See docs/messages.md.
 */
test.describe('Toasts and messages', () => {
  test('a MessageToast stays assertable long after it has vanished from the screen', async ({
    page,
  }) => {
    const cart = new CartPage(page);
    await cart.open();

    // Clearing first means the assertion below can only match a toast *this* action raised.
    await Ui5MessageToast.clear(page);
    expect(await Ui5MessageToast.texts(page)).toEqual([]);

    await cart.firstAddToCartButton.click();

    const toast = await Ui5MessageToast.waitForText(page, /added to your shopping cart/i);
    expect(toast).toMatch(/added to your shopping cart/i);

    // The point of recording toasts rather than reading the DOM: once the toast's own ~3s timer
    // fires it's gone from the page entirely - but still perfectly assertable here. A DOM-based
    // check is racing that timer, which is exactly why toast assertions have a reputation for
    // passing locally and flaking in CI.
    //
    // Note this waits for the toast to disappear with an auto-retrying `toHaveCount(0)` rather
    // than a fixed `waitForTimeout` - an earlier draft of this very test used a fixed 4s wait and
    // flaked on the third run, because the toast occasionally lingers a little longer under load.
    // Racing a timer is no more reliable when you're waiting for something to go away.
    await expect(page.locator('.sapMMessageToast')).toHaveCount(0);
    expect(await Ui5MessageToast.texts(page)).toContain(toast);
  });

  test('toast text can come from the app own i18n bundle too', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();
    await Ui5MessageToast.clear(page);

    // The app raises this toast with a translated string, so the test asserts on the same key the
    // app renders from rather than on one language's version of it - `Ui5I18n` and
    // `Ui5MessageToast` composing exactly as you'd hope.
    const expected = await Ui5I18n.getText(page, 'avatarButtonMessageToastText');
    await page.getByRole('button', { name: /login/i }).first().click();

    expect(await Ui5MessageToast.waitForText(page, expected)).toBe(expected);
  });

  test('the message model is empty on a healthy app', async ({ page }) => {
    const cart = new CartPage(page);
    await cart.open();

    // SAPUI5 collects validation errors, OData backend errors and app-raised messages in one
    // central model - the thing a Fiori message popover renders from. "Nothing went wrong" is the
    // single most useful assertion against it, and it catches backend errors the UI never
    // surfaced anywhere visible.
    expect(await Ui5Messages.errors(page)).toEqual([]);
    expect(await Ui5Messages.all(page)).toEqual([]);
  });
});
