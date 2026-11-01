import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartTable } from './chart-table';

describe('ChartTable', () => {
  it('renders the caption, column headers and one row per data point', () => {
    render(
      <ChartTable
        caption="Weight, 1 Sep to 5 Oct"
        columns={['Day', 'Weight (kg)', '7-day average (kg)']}
        rows={[
          ['Mon 1 Sep', '80.0', '80.0'],
          ['Tue 2 Sep', '79.9', '79.95'],
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Weight, 1 Sep to 5 Oct' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Day', 'Weight (kg)', '7-day average (kg)']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2
    expect(
      within(rows[2]!)
        .getAllByRole('cell')
        .map((td) => td.textContent),
    ).toEqual(['Tue 2 Sep', '79.9', '79.95']);
  });

  it('is visually hidden but present in the accessibility tree', () => {
    render(<ChartTable caption="Empty" columns={['Day']} rows={[]} />);
    const table = screen.getByRole('table', { name: 'Empty' });
    expect(table).toHaveClass('sr-only');
    expect(table).not.toHaveAttribute('aria-hidden');
  });
});
