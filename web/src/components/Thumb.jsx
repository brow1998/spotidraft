import { useEffect, useState } from "react";

/**
 * Image with a graceful fallback. Deleted, private and members-only videos
 * return a 404 from i.ytimg.com, which otherwise renders a broken-image glyph.
 */
export function Thumb({ src, alt = "", className = "", fallbackText = "sem imagem" }) {
  const [failed, setFailed] = useState(false);

  // A new src deserves a fresh attempt.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <span className={`thumb-fallback ${className}`.trim()} aria-hidden="true">
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      className={className || undefined}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default Thumb;
