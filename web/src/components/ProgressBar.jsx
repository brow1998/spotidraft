/**
 * @param {object} props
 * @param {number|null} props.value 0..100. null renders an indeterminate bar.
 * @param {string} [props.label] shown above the track
 * @param {string} [props.detail] right-aligned secondary text (speed, ETA…)
 * @param {string} [props.valueText] spoken value; falls back to "N%"
 */
export function ProgressBar({ value, label, detail, valueText, tone = "primary" }) {
  const indeterminate = value == null || Number.isNaN(value);
  const pct = indeterminate ? null : Math.max(0, Math.min(100, value));

  return (
    <div className="progress">
      {(label || detail) && (
        <div className="progress-head">
          {label && <span className="progress-label">{label}</span>}
          {detail && <span className="progress-detail">{detail}</span>}
        </div>
      )}
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        // An indeterminate progressbar must omit valuenow, not send 0.
        aria-valuenow={indeterminate ? undefined : Math.round(pct)}
        aria-valuetext={valueText || (indeterminate ? "em andamento" : `${Math.round(pct)}%`)}
        aria-label={label || undefined}
      >
        <div
          className={`progress-fill tone-${tone}${indeterminate ? " indeterminate" : ""}`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
