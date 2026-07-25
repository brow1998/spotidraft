# Product

## Register

product

## Users

Creators and small ops teams who already publish video on YouTube and want the same episodes on Spotify for Creators—starting with internal teams (e.g. Gweek), later possibly external creators. They are mid-task: paste a link, decide what to import, keep an eye on progress, and jump to Spotify to verify drafts. Technical comfort varies; cookie/curl refresh must be copy-paste simple, not a DevTools scavenger hunt.

## Product Purpose

**Spotidraft** turns a YouTube URL (video, playlist, or channel) into Spotify for Creators episode drafts. Success = a non-engineer can refresh session auth, choose which videos and media options to import, watch the job finish, and open Creators to confirm—without touching the CLI.

## Brand Personality

Charismatic, minimal, confident. Dark, clean, elegant with enough character that it does not feel like another gray SaaS console. Voice is short and direct; humor only when it reduces anxiety (failed login, long uploads).

## Anti-references

- Generic SaaS dashboards (purple gradients, Inter-everywhere, metric card grids)
- Meaningless decorative gradients and glow
- Generic “AI default” fonts and senseless accent buttons
- Over-decorated admin themes and “hacker terminal” dark modes

## Design Principles

1. **One job per surface** — Import, auth, progress, and “open Spotify” are obvious; no scavenger hunt.
2. **Review before commit** — Always show what the URL resolved to and let the user choose videos + options before upload.
3. **Draft-first trust** — Default to Spotify drafts; never surprise-publish.
4. **Honest status** — Progress, failures, and “session expired” are visible and recoverable (curl paste).
5. **Character without clutter** — Personality in type, color restraint, and copy—not in chrome or ornament.

## Accessibility & Inclusion

Aim for WCAG 2.2 AA on interactive controls and text contrast on dark surfaces. Respect `prefers-reduced-motion`. Keyboard-reachable primary actions (import, save session, open Creators). Clear error text, not icon-only failure states.
