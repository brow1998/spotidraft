/**
 * Placeholder blocks for content that is still loading. Marked aria-hidden and
 * wrapped in an aria-busy region so screen readers hear "carregando" once
 * instead of a wall of empty boxes.
 */
function Line({ width = "100%" }) {
  return <span className="skeleton skeleton-line" style={{ width }} />;
}

function Thumb() {
  return <span className="skeleton skeleton-thumb" />;
}

function Card() {
  return (
    <div className="skeleton-card">
      <Thumb />
      <Line width="85%" />
      <Line width="55%" />
    </div>
  );
}

function Row() {
  return (
    <div className="skeleton-row">
      <span className="skeleton skeleton-chip" />
      <Line width="60%" />
    </div>
  );
}

export function SkeletonGroup({ count = 6, as = "card", label = "Carregando…" }) {
  const Item = as === "row" ? Row : Card;
  return (
    <div
      className={as === "row" ? "skeleton-rows" : "yt-shelf-grid"}
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true">
          <Item />
        </div>
      ))}
    </div>
  );
}

export const Skeleton = { Line, Thumb, Card, Row, Group: SkeletonGroup };
export default Skeleton;
