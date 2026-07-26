/**
 * The Spotidraft mark: a play triangle (YouTube side) resolving into audio bars
 * (Spotify side). Kept in sync with web/public/favicon.svg and the Electron icon.
 */
export function Logo({ size = 26 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="logo-mark"
    >
      <defs>
        <linearGradient id="logo-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.85 0.11 170)" />
          <stop offset="1" stopColor="oklch(0.62 0.11 170)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="oklch(0.17 0.012 170)" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="14.25"
        fill="none"
        stroke="oklch(0.32 0.018 170)"
        strokeWidth="1.5"
      />
      <path d="M18 17 L18 47 L35 32 Z" fill="url(#logo-teal)" />
      <g fill="var(--accent)">
        <rect x="38.5" y="27" width="4" height="10" rx="2" />
        <rect x="45" y="19" width="4" height="26" rx="2" />
        <rect x="51.5" y="24" width="4" height="16" rx="2" />
      </g>
    </svg>
  );
}

export default Logo;
