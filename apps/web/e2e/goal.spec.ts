import type { DiaryEntry, Food, MealSlot } from '@plate/shared';
import { browserTodayKey, expect, test } from './fixtures';

// Goal set through the UI, then the ring colour follows the day status (DESIGN §2.1): green inside
// the ±10 % band, red once over. Entries are seeded through the API to keep the test about the ring.
test('setting a goal colours the ring on target, then over', async ({ loggedIn: page, api }) => {
  await page.goto('/more');
  await page.getByRole('button', { name: 'Set a goal' }).click();
  const editor = page.getByRole('dialog', { name: 'Set your goal' });
  await expect(editor).toBeVisible();
  // Typing the calories fills the macro targets from the balanced preset (D32).
  await editor.getByLabel('Calories per day').fill('500');
  await editor.getByRole('button', { name: 'Save goal' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('Goal saved')).toBeVisible();

  const food = await api<Food>('POST', '/foods', {
    name: 'Cucumber',
    per100: {
      kcal: 30,
      protein: 0.7,
      carbs: 3.6,
      fat: 0.1,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    },
  });
  const slots = await api<MealSlot[]>('GET', '/meal-slots');
  const slot = slots.find((s) => s.archivedAt === null);
  if (!slot) throw new Error('no active meal slot');
  const day = await browserTodayKey(page);
  // Specs share one database per run (workers: 1); start from an empty day.
  const existing = await api<{ slots: { entries: { id: number }[] }[] }>('GET', `/diary/${day}`);
  for (const slot of existing.slots) {
    for (const entry of slot.entries) await api('DELETE', `/diary/entries/${entry.id}`);
  }
  const log = (quantity: number) =>
    api<DiaryEntry>('POST', '/diary/entries', {
      day,
      slotId: slot.id,
      loggedAt: `${day}T12:00:00`,
      foodId: food.id,
      quantity,
    });

  // 1,650 g × 30 kcal/100 g = 495 kcal: within 10 % of 500.
  await log(1650);
  await page.goto(`/today/${day}`);
  const summary = page.getByRole('region', { name: 'Day summary' });
  const ringFill = summary.locator('[role="progressbar"] circle:nth-of-type(2)');
  await expect(summary).toContainText('495');
  await expect(summary.getByText('On target', { exact: true })).toBeVisible();
  await expect(ringFill).toHaveClass(/stroke-on-target/);

  // +450 g → 630 kcal: 26 % over the goal.
  await log(450);
  await page.reload();
  await expect(summary).toContainText('630');
  await expect(summary.getByText('Over goal', { exact: true })).toBeVisible();
  await expect(summary).toContainText('130 over');
  await expect(ringFill).toHaveClass(/stroke-over/);
});
