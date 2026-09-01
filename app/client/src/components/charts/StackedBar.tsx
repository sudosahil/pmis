import { share } from './chart-kit';

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface StackedBarProps {
  segments: Segment[];
  /** Rendered after each count in the legend, e.g. "works" or "tenders". */
  unit: string;
}

/**
 * One horizontal bar divided into its parts.
 *
 * A part-to-whole reading, which is what a status mix is, belongs in a stacked
 * bar rather than a pie: the segments share a baseline, so they can actually be
 * compared with one another, and long status names sit beside the bar instead
 * of being crammed into a wedge.
 */
export function StackedBar({ segments, unit }: StackedBarProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const shown = segments.filter((segment) => segment.value > 0);

  if (total === 0) return null;

  return (
    <div className="stackbar">
      <div
        className="stackbar__track"
        role="img"
        aria-label={shown
          .map((segment) => `${segment.label}: ${segment.value} ${unit}`)
          .join('; ')}
      >
        {shown.map((segment) => (
          <span
            key={segment.key}
            className="stackbar__segment"
            style={{ width: `${share(segment.value, total)}%`, background: segment.color }}
            title={`${segment.label}: ${segment.value} ${unit}`}
          />
        ))}
      </div>

      <ul className="stackbar__legend">
        {shown.map((segment) => (
          <li key={segment.key}>
            <span className="chart__swatch" style={{ background: segment.color }} aria-hidden="true" />
            <span className="stackbar__legend-label">{segment.label}</span>
            <span className="stackbar__legend-value">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
