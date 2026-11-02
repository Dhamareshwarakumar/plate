import { expect, loginThroughForm, test } from './fixtures';

// The core flow from TECH §9: sign in → add a food → log 450 g → the summary shows the derived
// calories → edit the quantity → delete → undo. Watermelon is the interview example (30 kcal/100 g).
test('login → add food → log 450 g → edit → delete → undo', async ({ page }) => {
  await loginThroughForm(page);

  // --- Library: create Watermelon ---
  await page.getByRole('link', { name: 'Foods' }).click();
  await expect(page).toHaveURL(/\/foods$/);
  // Phones show the FAB (and the empty state's own button); either opens /foods/new.
  await page.getByRole('link', { name: 'New food' }).first().click();
  await expect(page).toHaveURL(/\/foods\/new$/);

  await page.getByLabel('Name', { exact: true }).fill('Watermelon');
  await page.getByLabel('Calories', { exact: true }).fill('30');
  await page.getByLabel('Protein', { exact: true }).fill('0.61');
  await page.getByLabel('Carbs', { exact: true }).fill('7.55');
  await page.getByLabel('Fat', { exact: true }).fill('0.15');
  await page.getByRole('button', { name: 'Save food' }).click();

  await expect(page.getByText('Watermelon added')).toBeVisible();
  await expect(page).toHaveURL(/\/foods$/);
  await expect(page.getByRole('link', { name: /^Watermelon/ })).toBeVisible();

  // --- Today: log 450 g ---
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page).toHaveURL(/\/today\/\d{4}-\d{2}-\d{2}$/);
  await page.locator('button[aria-label="Log food"]').click();

  // One dialog at a time; its title changes from "Log food" to the picked food's name.
  const sheet = page.getByRole('dialog');
  await expect(sheet).toHaveAccessibleName('Log food');
  await sheet.getByLabel('Search foods').fill('Watermelon');
  await sheet.getByRole('button', { name: /^Watermelon/ }).click();

  await expect(sheet).toHaveAccessibleName('Watermelon');
  const quantity = sheet.getByLabel('Quantity');
  await expect(quantity).toBeVisible();
  await quantity.fill('450');
  await sheet.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(sheet).toBeHidden();

  // 30 kcal/100 g × 450 g = 135 kcal, derived from the stored per-100 snapshot (D41).
  const summary = page.getByRole('region', { name: 'Day summary' });
  await expect(summary).toContainText('135');
  // Rows collapse out over ~300 ms when the optimistic entry is swapped for the saved one; wait for
  // the list to settle before touching the single remaining row.
  const anyRow = page.getByRole('button', { name: /^Edit Watermelon/ });
  await expect(anyRow).toHaveCount(1);
  const row = page.getByRole('button', { name: /^Edit Watermelon, 450 g, 135 kcal/ });
  await expect(row).toBeVisible();

  // --- Edit: 300 g → 90 kcal ---
  await row.click();
  await expect(sheet).toHaveAccessibleName('Watermelon');
  await sheet.getByLabel('Quantity').fill('300');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();

  const editedRow = page.getByRole('button', { name: /^Edit Watermelon, 300 g, 90 kcal/ });
  await expect(editedRow).toBeVisible();
  await expect(summary).toContainText('90');
  await expect(summary).not.toContainText('135');

  // --- Delete with undo (D45) ---
  await editedRow.click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sheet).toBeHidden();

  const toast = page.getByText('Watermelon removed');
  await expect(toast).toBeVisible();
  await expect(anyRow).toHaveCount(0);
  await expect(page.getByText(/Nothing logged on/)).toBeVisible();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(anyRow).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: /^Edit Watermelon, 300 g, 90 kcal/ }),
  ).toBeVisible();
  await expect(summary).toContainText('90');
});
