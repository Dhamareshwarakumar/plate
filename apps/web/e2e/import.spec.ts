import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';

const csvPath = fileURLToPath(new URL('./fixtures/foods.csv', import.meta.url));

// CSV import preview (FR-F6, TECH §5.3): the dry run reports per-row outcomes before anything is
// written; the fixture has two valid rows and one with an unknown category.
test('CSV import previews row outcomes, then imports the valid rows', async ({
  loggedIn: page,
}) => {
  await page.goto('/foods');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Import CSV…' }).click();

  const sheet = page.getByRole('dialog', { name: 'Import foods from CSV' });
  await expect(sheet).toBeVisible();
  await sheet.locator('input[type="file"]').setInputFiles(csvPath);

  await expect(sheet.getByText('foods.csv')).toBeVisible();
  const stat = (label: string) =>
    sheet.locator('dt', { hasText: new RegExp(`^${label}$`, 'i') }).locator('+ dd');
  await expect(stat('New')).toHaveText('2');
  await expect(stat('Update')).toHaveText('0');
  await expect(stat('Skip')).toHaveText('0');
  await expect(stat('Errors')).toHaveText('1');
  await expect(sheet.getByText(/unknown category/i)).toBeVisible();

  await sheet.getByRole('button', { name: 'Import 2 foods' }).click();
  await expect(sheet).toBeHidden();

  await expect(page.getByText('Banana')).toBeVisible();
  await expect(page.getByText('Milk, whole')).toBeVisible();
  await expect(page.getByText('Mystery snack')).toHaveCount(0);
});
