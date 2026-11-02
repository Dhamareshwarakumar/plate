import type { TopFoods as TopFoodsData } from '@plate/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { TopFoods } from './TopFoods';

const data: TopFoodsData = {
  byCount: [
    { foodId: 3, kind: 'food', name: 'Oats', count: 11, kcal: 5470 },
    { foodId: 9, kind: 'dish', name: 'Dal', count: 4, kcal: 1200 },
    { foodId: null, kind: null, name: 'Protein bar', count: 2, kcal: 400 },
  ],
  byKcal: [],
};

afterEach(cleanup);

describe('TopFoods', () => {
  it('links foods to the food editor and dishes to the dish editor; ad-hoc rows are plain text', () => {
    render(
      <MemoryRouter>
        <TopFoods data={data} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Oats' })).toHaveAttribute('href', '/foods/3');
    expect(screen.getByRole('link', { name: 'Dal' })).toHaveAttribute('href', '/foods/dishes/9');
    expect(screen.queryByRole('link', { name: /Protein bar/ })).toBeNull();
    expect(screen.getByText('Protein bar')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
