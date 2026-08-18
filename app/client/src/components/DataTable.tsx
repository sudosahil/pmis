import type { ReactNode } from 'react';
import { EmptyState, Loading } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Right-aligns and tabular-figures the cell — use for money and counts. */
  numeric?: boolean;
  /** Pushes the cell to the right edge without number formatting. */
  actions?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: { title: string; text?: string; action?: ReactNode };
  compact?: boolean;
  footer?: ReactNode;
  caption?: string;
}

export function DataTable<T>({
  columns, rows, rowKey, loading, onRowClick, empty, compact, footer, caption,
}: DataTableProps<T>) {
  if (loading) return <Loading />;

  if (!rows.length) {
    return (
      <EmptyState
        title={empty?.title ?? 'Nothing to show yet'}
        text={empty?.text}
        action={empty?.action}
      />
    );
  }

  return (
    <div className="table-wrap">
      <table className={`table${compact ? ' table--compact' : ''}${footer ? ' table--totals' : ''}`}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.numeric || column.actions ? 'num' : undefined}
                style={column.width ? { width: column.width } : undefined}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.numeric ? 'num' : column.actions ? 'actions' : undefined}
                  // A click inside the actions cell must not also open the row.
                  onClick={column.actions ? (event) => event.stopPropagation() : undefined}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Pagination({
  page, pageSize, total, onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  // Show a sliding window of five page numbers around the current page.
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4));
  const windowEnd = Math.min(pageCount, windowStart + 4);
  const pages: number[] = [];
  for (let n = windowStart; n <= windowEnd; n += 1) pages.push(n);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        Showing <strong>{first}</strong>–<strong>{last}</strong> of <strong>{total}</strong>
      </span>
      {pageCount > 1 && (
        <div className="pagination__pages">
          <button
            type="button"
            className="page-btn"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Previous
          </button>
          {windowStart > 1 && (
            <>
              <button type="button" className="page-btn" onClick={() => onPageChange(1)}>1</button>
              {windowStart > 2 && <span aria-hidden="true">…</span>}
            </>
          )}
          {pages.map((n) => (
            <button
              key={n}
              type="button"
              className={`page-btn${n === page ? ' is-active' : ''}`}
              onClick={() => onPageChange(n)}
              aria-current={n === page ? 'page' : undefined}
            >
              {n}
            </button>
          ))}
          {windowEnd < pageCount && (
            <>
              {windowEnd < pageCount - 1 && <span aria-hidden="true">…</span>}
              <button type="button" className="page-btn" onClick={() => onPageChange(pageCount)}>
                {pageCount}
              </button>
            </>
          )}
          <button
            type="button"
            className="page-btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
          >
            Next
          </button>
        </div>
      )}
    </nav>
  );
}
