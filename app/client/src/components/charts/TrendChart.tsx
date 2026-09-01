import { useId, useState } from 'react';
import { axisMoney, monthLabel, monthLabelLong, niceMax, ticks } from './chart-kit';

export interface TrendSeries {
  key: string;
  label: string;
  /** A categorical slot from chart-kit's SERIES, in assignment order. */
  color: string;
  values: number[];
}

interface TrendChartProps {
  months: string[];
  series: TrendSeries[];
  /** Renders a value for the tooltip and the axis reading. */
  format: (value: number) => string;
  height?: number;
  caption: string;
}

/** Drawn in a fixed coordinate space and scaled by the viewBox to fit its card. */
const W = 760;
const PAD = { top: 16, right: 18, bottom: 30, left: 62 };

/**
 * A multi-series line chart over a continuous month axis.
 *
 * The month axis is continuous because the server fills the empty months in: a
 * line that steps over a quiet month draws straight through it and reports work
 * that never happened.
 */
export function TrendChart({ months, series, format, height = 260, caption }: TrendChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 0));
  const x = (i: number) => PAD.left + (months.length <= 1 ? plotW / 2 : (plotW / (months.length - 1)) * i);
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;

  // A label on every month would collide; every third keeps the ends readable.
  const labelEvery = Math.max(1, Math.ceil(months.length / 7));

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const withinViewBox = ((event.clientX - rect.left) / rect.width) * W;
    const nearest = Math.round(((withinViewBox - PAD.left) / plotW) * (months.length - 1));
    setActive(Math.min(months.length - 1, Math.max(0, nearest)));
  };

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-labelledby={titleId}
        onMouseMove={onMove}
        onMouseLeave={() => setActive(null)}
      >
        <title id={titleId}>{caption}</title>

        {ticks(max).map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)}
              className="chart__grid"
            />
            <text x={PAD.left - 10} y={y(tick) + 4} className="chart__axis-label" textAnchor="end">
              {axisMoney(tick)}
            </text>
          </g>
        ))}

        {months.map((month, i) =>
          i % labelEvery === 0 || i === months.length - 1 ? (
            <text key={month} x={x(i)} y={H - 10} className="chart__axis-label" textAnchor="middle">
              {monthLabel(month)}
            </text>
          ) : null,
        )}

        {active !== null && (
          <line
            x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH}
            className="chart__crosshair"
          />
        )}

        {series.map((s) => (
          <polyline
            key={s.key}
            className="chart__line"
            stroke={s.color}
            points={s.values.map((value, i) => `${x(i)},${y(value)}`).join(' ')}
          />
        ))}

        {/* Only the hovered points get markers; a dot on every month is noise. */}
        {active !== null &&
          series.map((s) => (
            <circle
              key={s.key}
              cx={x(active)} cy={y(s.values[active] ?? 0)} r={5}
              fill={s.color} className="chart__marker"
            />
          ))}
      </svg>

      {active !== null && (
        <div
          className="chart__tooltip"
          style={{
            left: `${(x(active) / W) * 100}%`,
            transform: `translateX(${active > months.length / 2 ? '-100%' : '0'}) translateX(${active > months.length / 2 ? '-12px' : '12px'})`,
          }}
        >
          <div className="chart__tooltip-head">{monthLabelLong(months[active]!)}</div>
          {series.map((s) => (
            <div key={s.key} className="chart__tooltip-row">
              <span className="chart__swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="chart__tooltip-label">{s.label}</span>
              <span className="chart__tooltip-value">{format(s.values[active] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      <ul className="chart__legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className="chart__swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
