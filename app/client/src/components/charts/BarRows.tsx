export interface BarRow {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  /**
   * The figure `value` is a part of — a sanctioned amount against which the
   * paid amount is read. Given, the row is drawn as a ratio against its own
   * limit and annotated with the percentage; omitted, it is drawn as a
   * magnitude against the largest row in the list.
   */
  of?: number;
  /** The right-hand reading. Defaults to the formatted value. */
  note?: string;
}

interface BarRowsProps {
  rows: BarRow[];
  format: (value: number) => string;
  /**
   * Ratios and magnitudes both take a single hue: these lists rank things, and
   * colouring a ranking categorically makes it harder to read, not easier.
   */
  color?: string;
}

/**
 * A list of horizontal bars, one per row.
 *
 * Horizontal because the labels are scheme and division names, which do not fit
 * under a vertical column without being turned on their side.
 */
export function BarRows({ rows, format, color = 'var(--series-1)' }: BarRowsProps) {
  const largest = Math.max(...rows.map((row) => row.value), 0);

  return (
    <ul className="barrows">
      {rows.map((row) => {
        const limit = row.of ?? largest;
        const pct = limit > 0 ? Math.min(100, (row.value / limit) * 100) : 0;
        const ratio = row.of !== undefined && row.of > 0
          ? Math.round((row.value / row.of) * 100)
          : null;

        return (
          <li key={row.key} className="barrows__row">
            <div className="barrows__head">
              <span className="barrows__label">
                {row.label}
                {row.sublabel && <span className="barrows__sublabel">{row.sublabel}</span>}
              </span>
              <span className="barrows__value">
                {row.note ?? format(row.value)}
                {ratio !== null && <span className="barrows__pct">{ratio}%</span>}
              </span>
            </div>
            <div
              className="barrows__track"
              role="img"
              aria-label={`${row.label}: ${row.note ?? format(row.value)}${
                ratio !== null ? `, ${ratio} per cent` : ''
              }`}
            >
              <span className="barrows__fill" style={{ width: `${pct}%`, background: color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
