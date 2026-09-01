import { useId, useState } from 'react';
import { niceMax } from './chart-kit';

export interface Column {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Shown in the tooltip under the value, e.g. the money held up in a bucket. */
  note?: string;
}

interface ColumnChartProps {
  columns: Column[];
  format: (value: number) => string;
  height?: number;
  caption: string;
}

const W = 520;
const PAD = { top: 26, right: 8, bottom: 42, left: 8 };

/**
 * Vertical columns for a small ordered set of buckets.
 *
 * Every column is labelled with its own figure, so the reading never depends on
 * the fill colour alone — which matters here because the ageing ramp runs
 * through amber and orange, and those clear the colour-blindness gates only
 * with a second encoding.
 */
export function ColumnChart({ columns, format, height = 220, caption }: ColumnChartProps) {
  const [active, setActive] = useState<string | null>(null);
  const titleId = useId();

  const H = height;
  const plotH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...columns.map((column) => column.value), 0));
  const slot = (W - PAD.left - PAD.right) / Math.max(1, columns.length);
  const barW = Math.min(76, slot * 0.56);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart__svg" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{caption}</title>
        <line
          x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH}
          className="chart__baseline"
        />

        {columns.map((column, i) => {
          const centre = PAD.left + slot * i + slot / 2;
          const barH = max > 0 ? (column.value / max) * plotH : 0;
          const top = PAD.top + plotH - barH;
          return (
            <g
              key={column.key}
              onMouseEnter={() => setActive(column.key)}
              onMouseLeave={() => setActive(null)}
            >
              {/* A hit area the full height of the plot, so the tooltip is easy to catch. */}
              <rect
                x={centre - slot / 2} y={PAD.top} width={slot} height={plotH}
                fill="transparent"
              />
              <rect
                x={centre - barW / 2} y={top} width={barW} height={Math.max(barH, column.value > 0 ? 3 : 0)}
                rx={4} fill={column.color}
                className={`chart__bar${active === column.key ? ' is-active' : ''}`}
              />
              <text x={centre} y={top - 9} className="chart__value" textAnchor="middle">
                {format(column.value)}
              </text>
              <text x={centre} y={H - 22} className="chart__axis-label" textAnchor="middle">
                {column.label}
              </text>
              {column.note && (
                <text x={centre} y={H - 7} className="chart__axis-note" textAnchor="middle">
                  {column.note}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
