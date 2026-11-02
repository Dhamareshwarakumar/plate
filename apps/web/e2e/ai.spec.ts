import { browserTodayKey, expect, test } from './fixtures';

interface FoodRow {
  id: number;
  name: string;
  source: string;
  estimatedAt: string | null;
}

// "Describe or photograph" end to end against the fake provider (AI_PROVIDER=fake in the web
// server env): the canned answer proposes a new food ("Roti (whole wheat)"), matches food id 1 and
// names an id that does not exist (sanitised by the server into a row that needs a food). Logging
// creates the proposed food with source 'ai' and writes the entries into the chosen meal.
test('describe a meal → review → log creates the new food and the entries', async ({
  loggedIn: page,
  api,
}) => {
  const dal = await api<FoodRow>('POST', '/foods', {
    name: 'Dal',
    basis: 'g',
    per100: {
      kcal: 116,
      protein: 9,
      carbs: 20,
      fat: 0.4,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    },
  });
  // The fake provider matches food id 1; on a shared database another spec may own that id.
  const before = await api<{ items: FoodRow[] }>('GET', '/foods');
  const matched = before.items.find((f) => f.id === 1);
  expect(matched, 'food 1 exists').toBeTruthy();

  await page.goto('/today');
  await expect(page).toHaveURL(/\/today\/\d{4}-\d{2}-\d{2}$/);
  await page.locator('button[aria-label="Log food"]').click();
  const logSheet = page.getByRole('dialog', { name: 'Log food' });
  await logSheet.getByRole('button', { name: 'Describe or photograph' }).click();

  const sheet = page.getByRole('dialog', { name: 'Describe or photograph' });
  await expect(sheet).toBeVisible();
  const analyse = sheet.getByRole('button', { name: 'Analyse' });
  await expect(analyse).toBeDisabled();
  await sheet.getByLabel('What did you eat?').fill('2 rotis, a bowl of dal, one banana');
  await analyse.click();

  const review = page.getByRole('dialog', { name: 'Review items' });
  await expect(review).toBeVisible();
  const rows = review.getByRole('list', { name: 'Recognised items' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Roti (whole wheat)');
  await expect(rows.nth(0)).toContainText('Estimated, new food');
  await expect(rows.nth(1)).toContainText(matched!.name);
  await expect(rows.nth(1)).toContainText('Library');
  await expect(rows.nth(2)).toContainText('Needs a food');
  await expect(review.getByRole('button', { name: 'Log 2 items' })).toBeEnabled();

  await review.getByRole('button', { name: 'Remove one banana' }).click();
  await expect(rows).toHaveCount(2);
  await review.getByRole('button', { name: 'Log 2 items' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('2 items logged')).toBeVisible();

  await expect(
    page.getByRole('button', { name: /^Edit Roti \(whole wheat\), 80 g/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: new RegExp(`^Edit ${matched!.name}, 200 g`) }),
  ).toBeVisible();

  const after = await api<{ items: FoodRow[] }>('GET', '/foods');
  const roti = after.items.find((f) => f.name === 'Roti (whole wheat)');
  expect(roti).toMatchObject({ source: 'ai' });
  expect(roti?.estimatedAt).not.toBeNull();

  // Leave the shared database as found: the specs after this one expect an empty day.
  const day = await api<{ slots: { entries: { id: number }[] }[] }>(
    'GET',
    `/diary/${await browserTodayKey(page)}`,
  );
  for (const slot of day.slots) {
    for (const entry of slot.entries) await api('DELETE', `/diary/entries/${entry.id}`);
  }
  await api('DELETE', `/foods/${roti!.id}`);
  await api('DELETE', `/foods/${dal.id}`);
});
