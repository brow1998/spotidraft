---
name: Spotidraft
description: YouTube → Spotify for Creators drafts — dark, minimal, charismatic tool UI
colors:
  bg: "oklch(0.12 0.000 0)"
  surface: "oklch(0.16 0.008 170)"
  surface-raised: "oklch(0.20 0.010 170)"
  ink: "oklch(0.96 0.010 170)"
  muted: "oklch(0.72 0.020 170)"
  primary: "oklch(0.72 0.12 170)"
  primary-deep: "oklch(0.52 0.10 170)"
  accent: "oklch(0.78 0.14 45)"
  danger: "oklch(0.62 0.18 25)"
  success: "oklch(0.72 0.12 150)"
  border: "oklch(0.28 0.012 170)"
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
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
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

- **Shell**: sticky left nav (Importar, Progresso, Sessão) + top strip with session chip + “Abrir no Spotify”.
- **Primary button**: teal fill with white text on saturated mid-L fills.
- **Ghost / secondary**: border or text-only.
- **Table**: dense video picker with checkboxes; options bar above.
- **Progress list**: status pill + title + error snippet; no metric-card grid.
- **Curl panel**: monospace textarea, paste → Salvar sessão.

## Do's and Don'ts

**Do**
- Keep one primary action per view.
- Show URL resolution before upload.
- Default imports to draft.
- Make session expiry obvious and recoverable via curl paste.

**Don't**
- Generic SaaS card grids or purple gradients.
- Inter / Roboto / system-only stacks as brand voice.
- Decorative motion or page-load choreography.
- Surprise-publish or hide failed jobs.
