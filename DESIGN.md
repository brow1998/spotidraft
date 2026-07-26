---
name: Spotidraft
description: YouTube → Spotify for Creators drafts — dark, minimal, charismatic tool UI
colors:
  bg: "oklch(0.11 0 0)"
  surface: "oklch(0.155 0.01 170)"
  surface-raised: "oklch(0.195 0.012 170)"
  ink: "oklch(0.96 0.008 170)"
  muted: "oklch(0.68 0.018 170)"
  primary: "oklch(0.7 0.11 170)"
  primary-deep: "oklch(0.48 0.09 170)"
  accent: "oklch(0.82 0.15 55)"
  danger: "oklch(0.65 0.17 25)"
  success: "oklch(0.72 0.11 155)"
  border: "oklch(0.26 0.014 170)"
  border-strong: "oklch(0.34 0.018 170)"
  focus: "oklch(0.78 0.1 170)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.02em"
rounded:
  sm: "8px"
  md: "12px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
  7: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#fff"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  nav-active:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  progress-bar:
    trackColor: "oklch(0.24 0.012 170)"
    fillColor: "{colors.primary}"
    fillColorUpload: "{colors.accent}"
    height: "8px"
    rounded: "{rounded.pill}"
  log-panel:
    backgroundColor: "oklch(0.09 0 0)"
    textColor: "{colors.muted}"
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    rounded: "{rounded.sm}"
  toast:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    accentBorder: "3px solid {colors.success} | {colors.danger} | {colors.primary}"
  skeleton:
    baseColor: "oklch(0.19 0.01 170)"
    highlightColor: "oklch(0.24 0.012 170)"
    rounded: "{rounded.sm}"
---

<!-- SEED -->

## Overview

Spotidraft is a dark product shell: left nav + main canvas. Personality lives in Plus Jakarta Sans (single modern sans — product UI) and sea-glass teal primary on near-black surfaces—not in decoration. One accent (warm amber) for “open Spotify” and rare highlights. Restrained strategy: accent ≤10%. Icon-first chrome on dense toolbars; text reserved for primary labels and CTAs.

Mood phrase: *late-night studio desk — mineral teal glow on charcoal metal, no neon.*

## Colors

- **bg / surface**: pure near-black and slightly teal-tinted panels (chroma low) so primary carries brand.
- **primary**: sea-glass teal (~170°) for primary actions and active nav.
- **accent**: warm amber for outbound Spotify CTA only.
- **semantic**: success/danger for job states; muted for secondary labels.
- Never purple SaaS gradients; never cream paper backgrounds.

## Typography

- **Plus Jakarta Sans** — single family for wordmark, titles, and UI (modern sans; no serif).
- Fixed rem scale; product density; no fluid hero type.
- Icon-first toolbars: `title` + `aria-label` on icon buttons; keep text on primary CTAs.

## Elevation

- Prefer 1px borders (`border`) over shadows.
- Raised surface for active nav / selected table rows.
- No glassmorphism; no multi-layer glow.

## Components

- **Shell**: sticky left nav + sticky top strip with session chip + “Abrir no Spotify”. Content is centred (`margin-inline: auto`) inside a 920px measure.
- **Primary button**: teal fill with white text on saturated mid-L fills.
- **Ghost / secondary**: border or text-only.
- **Table**: dense video picker with checkboxes; options bar above. Selection checkboxes are hover/focus-revealed and stay visible once checked — an affordance, not content.
- **Progress**: two stacked bars per job (download teal, upload amber), each with the in-flight item, speed and ETA. Indeterminate fill for the ffmpeg merge, which reports no progress.
- **Toasts**: bottom-right, two live regions (polite for ok/info, assertive for errors). Errors persist until dismissed. Mounted above the router so a message survives navigation.
- **Log panel**: collapsed by default; monospace, capped, tail-following until the user scrolls up.
- **Curl panel**: monospace textarea, paste → Salvar sessão.

## Do's and Don'ts

**Do**
- Keep one primary action per view.
- Show URL resolution before upload.
- Default imports to draft.
- Make session expiry obvious and recoverable via curl paste.
- Show real progress for anything slow: a bar, the current item, and why it's waiting.
- Put errors next to the control that caused them; keep destructive actions behind a styled dialog, never `window.confirm`.

**Don't**
- Generic SaaS card grids or purple gradients.
- Inter / Roboto / system-only stacks as brand voice.
- Decorative motion or page-load choreography — the only animation is functional (progress, skeleton), and it respects `prefers-reduced-motion`.
- Surprise-publish or hide failed jobs.
- Interrupt with a dialog to ask what an action already implied.
