# Full-Ride Critique — Pass 2 (2026-07-10)

Re-swept after Pass 1. The defect list is STRICTLY SHORTER (Pass 1 had 1 critical + 4 important + 1 minor; Pass 2 has 0 critical + 2 important + 1 minor). No CRITICAL remains → no Pass 3 needed.

## Resolved in Pass 1 (verified by controller)
- C1 finale over-bloom → FIXED (moon reads as a disc with crater texture + soft halo; closing type legible; bike silhouette at 1.0). Controller-verified at 0.90.
- I1 intro subtitle "FULL-STACK" → FIXED to "ML SYSTEMS · ON-DEVICE INFERENCE". Controller-verified at 0.
- I3 drift → improved (crossing/neon now framed).

## Remaining IMPORTANT (content-showcase — the site's core purpose)

### I4 — Projects displays not prominent (t 0.44–0.46)
The project holo panels (TTT-E2E, RememberMe) are small strips high on the building wall; the biker is a speck. City window-grids dominate the frame. The project CONTENT should be the visual focus during the projects section (this is a portfolio — projects are the point). Fix: make the two main project panels large and central in the fixed side-camera view, with title/stack/blurb legible. The arcing biker is secondary. (File: src/choreography/segments/projects.ts — panel size/position and/or side-camera framing.)

### I2 — Research large panels off-axis (t 0.66–0.74)
The 2 large research holo-panels (Mobile Intelligence Lab, LLM HW Benchmarking) are hard to read — off-axis from the leading camera at ±8m lateral. Garnish labels read but the main panels (title + ~70-word description) don't get a clear readable moment. Fix: ensure at least one large research panel is centered and readable for a stretch. (File: src/choreography/segments/research.ts.)

## Remaining MINOR
### M1 — Intro title panel slight building overlap (t=0) — cosmetic, defer-acceptable.

## Decision
Do ONE consolidated fix for I4 + I2 (portfolio content prominence). M1 is acceptable as-is. After that, Task 34 is complete — the ride reads cinematically with the finale money shot working and all content showcased/legible.
