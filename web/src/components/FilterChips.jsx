/**
 * A set of toggle filters. Deliberately NOT role="tablist": these narrow one
 * list in place, they don't switch between panels. Tab semantics here would
 * promise a tabpanel that doesn't exist.
 *
 * @param {object} props
 * @param {Array<{id: string, label: string}>} props.options
 * @param {string} props.value
 * @param {(id: string) => void} props.onChange
 * @param {Record<string, number>} [props.counts]
 */
export function FilterChips({ options, value, onChange, counts, label }) {
  return (
    <div className="filter-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={`filter-chip ${value === o.id ? "active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {counts && <span className="filter-count">{counts[o.id] ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}

export default FilterChips;
