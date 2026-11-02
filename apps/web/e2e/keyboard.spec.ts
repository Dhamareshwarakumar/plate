import { expect, loginThroughForm, test } from './fixtures';

// Desktop affordances (DESIGN §9–§10): `?` lists the shortcuts, Escape closes a sheet and focus
// returns to what opened it, or to <main> when that element is gone.
test.describe('keyboard and focus (desktop)', () => {
  test('? opens the shortcuts help and Escape closes it', async ({ loggedIn: page }) => {
    await page.goto('/today');
    await expect(page.getByRole('region', { name: 'Day summary' })).toBeVisible();

    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help.getByText('Show this help')).toBeVisible();
    await expect(help.getByText('Previous or next day')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    // The sidebar button is the discoverable way in.
    await page.getByRole('button', { name: 'Shortcuts' }).click();
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
  });

  test('? does nothing while typing in a field', async ({ loggedIn: page }) => {
    await page.goto('/foods');
    const search = page.getByLabel('Search foods');
    await search.click();
    await page.keyboard.type('?');
    await expect(search).toHaveValue('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  });

  test('closing the log sheet returns focus to the sidebar link that opened it', async ({
    page,
  }) => {
    await loginThroughForm(page);
    const logLink = page.getByRole('link', { name: 'Log food' });
    await logLink.click();
    const sheet = page.getByRole('dialog', { name: 'Log food' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Search foods')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(logLink).toBeFocused();
  });

  test('closing an editor route moves focus to <main> instead of dropping it on <body>', async ({
    loggedIn: page,
  }) => {
    await page.goto('/foods');
    await page.getByRole('link', { name: 'New food' }).click();
    await expect(page).toHaveURL(/\/foods\/new$/);
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close editor' }).click();
    await expect(page).toHaveURL(/\/foods$/);
    await expect(page.locator('#main')).toBeFocused();
  });
});
