import type { Food } from '@plate/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodForm } from './FoodForm';

const banana: Food = {
  id: 7,
  kind: 'food',
  name: 'Banana',
  brand: null,
  categoryId: null,
  basis: 'g',
  per100: {
    kcal: 89,
    protein: 1.1,
    carbs: 22.8,
    fat: 0.3,
    fiber: null,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  },
  portions: [
    { id: 1, label: '1 small', amount: 101, sortOrder: 0 },
    { id: 2, label: '1 medium', amount: 118, sortOrder: 1 },
    { id: 3, label: '1 large', amount: 136, sortOrder: 2 },
  ],
  source: 'manual',
  offCode: null,
  estimatedAt: null,
  staleSince: null,
  archivedAt: null,
  createdAt: '2025-10-01T08:00:00.000Z',
  updatedAt: '2025-10-01T08:00:00.000Z',
};

/** The portion labels in on-screen order. */
const labels = () =>
  ['1', '2', '3'].map((n) => screen.getByLabelText<HTMLInputElement>(`Portion ${n} label`).value);
const amounts = () =>
  ['1', '2', '3'].map(
    (n) => screen.getByLabelText<HTMLInputElement>(`Portion ${n} amount in g`).value,
  );

function renderForm(onSubmit = vi.fn(async () => undefined)) {
  render(
    <FoodForm food={banana} categories={[]} onSubmit={onSubmit} submitting={false} mode="edit" />,
  );
  return onSubmit;
}

afterEach(cleanup);

describe('FoodForm portions', () => {
  it('moves a portion with the keyboard buttons and keeps label and amount together', async () => {
    renderForm();
    const user = userEvent.setup();
    expect(labels()).toEqual(['1 small', '1 medium', '1 large']);

    await user.click(screen.getByRole('button', { name: 'Move portion 1 down' }));
    expect(labels()).toEqual(['1 medium', '1 small', '1 large']);
    expect(amounts()).toEqual(['118', '101', '136']);

    await user.click(screen.getByRole('button', { name: 'Move portion 3 up' }));
    expect(labels()).toEqual(['1 medium', '1 large', '1 small']);
    expect(amounts()).toEqual(['118', '136', '101']);
  });

  it('disables the move that would leave the list, and submits the new order', async () => {
    const onSubmit = renderForm();
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Move portion 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move portion 3 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move portion 2 up' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Move portion 3 up' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [values] = onSubmit.mock.calls[0] as unknown as [
      { portions: { label: string; amount: string }[] },
    ];
    expect(values.portions.map((p) => p.label)).toEqual(['1 small', '1 large', '1 medium']);
  });

  it('renders the drag handles as decoration (the buttons are the accessible path)', () => {
    renderForm();
    const list = screen.getByRole('list', { name: 'Portions' });
    expect(list.querySelectorAll('[aria-hidden="true"] svg')).toHaveLength(3);
  });
});
