export interface ChartTableProps {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}

/**
 * The accessible twin of a chart (DESIGN §10): a visually hidden table with the plotted values.
 * Render it next to the chart's SVG, which should carry `aria-hidden`, so screen readers get one
 * representation of the data instead of a pile of unlabeled paths.
 */
export function ChartTable({ caption, columns, rows }: ChartTableProps) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
