# evanly.me — Cyberpunk Scroll Portfolio

A scroll-driven cinematic portfolio built as a Tron-style bike ride through a
procedurally generated neon cyberpunk city. As the visitor scrolls, the camera
follows a Tron lightcycle through a fully synthetic urban environment: glowing
billboards reveal About, Projects, and Research content as in-world ads; the
journey ends on a moonlit bridge before the page transitions into traditional
DOM resume sections below the fold. No external 3-D models are used — the
entire city is generated from seeded procedural geometry at runtime.

Stack: Vite + TypeScript + Three.js + GSAP, deployed to Vercel.

---

## Running locally

```bash
npm i
npm run dev      # local dev server (http://localhost:5173)
npm run build    # typecheck (tsc --noEmit) + production build → dist/
npm test         # vitest unit suite
```

---

## Screenshot harness

The `shoot` script drives a headless Playwright browser and captures frames at
arbitrary scroll positions.

```bash
# Shoot the timeline at scroll fractions 0, 0.1, 0.5, 1.0
npm run shoot -- --scroll 0,0.1,0.5,1.0

# Use a named viewer to audit a specific asset or system
npm run shoot -- --scroll 0.3 -- ?viewer=traffic

# Draw-call + asset audit at a given scroll position
node tools/shootAudit.mjs --scroll 0.5
```

---

## Editing copy

All text content — tagline, About paragraph, project titles/stacks/blurbs,
research entries, education, skills, experience, achievements, and contact
details — lives in one file:

```
src/content/resume.ts
```

The exported `RESUME` object is the single source of truth. Every consumer
(in-world billboard textures, DOM post-hero sections, and the screen-reader
sr-only mirror) reads from it. Edit the values there; nothing else needs
changing.

---

## Replacing placeholder images

Every image in the portfolio is an `ImageSlot` (`{ src, w, h, label }`). Set
the `src` field to a path (relative to `public/`) or an absolute URL to replace
the placeholder texture. While `src` is `null`, a generated neon placeholder is
rendered instead.

All slots are defined in `src/content/resume.ts` inside the `RESUME` object.

| Slot | Field path in `resume.ts` | Required dimensions | Description |
|------|--------------------------|---------------------|-------------|
| Face portrait | `RESUME.about.faceImage` | 800 x 1000 px | Head-and-shoulders portrait, used on the About billboard |
| About misc 1 | `RESUME.about.misc[0]` | 800 x 600 px | Supplementary image on the About billboard |
| About misc 2 | `RESUME.about.misc[1]` | 800 x 600 px | Second supplementary image on the About billboard |
| TTT-E2E | `RESUME.projectsMain[0].image` | 1280 x 720 px | Main project billboard — test-time training research |
| RememberMe | `RESUME.projectsMain[1].image` | 1280 x 720 px | Main project billboard — face-attribute recognition pipeline |
| Mandarin App | `RESUME.projectsSmall[0].image` | 800 x 600 px | Small project billboard — mobile Mandarin tutor |
| Bellevue Hackathon | `RESUME.projectsSmall[1].image` | 800 x 600 px | Small project billboard — 2nd place 2024 |
| DubHacks 2025 | `RESUME.projectsSmall[2].image` | 800 x 600 px | Small project billboard — Growth Track competitor |
| Mobile Intelligence Lab | `RESUME.research[0].image` | 1280 x 720 px | Research billboard — microLLM / MAM project |
| LLM Hardware Benchmarking | `RESUME.research[1].image` | 1280 x 720 px | Research billboard — GGUF quantization benchmarking |

Example — set a local image for the face portrait:

```ts
// src/content/resume.ts
faceImage: { src: '/images/face.jpg', w: 800, h: 1000, label: 'FACE PORTRAIT' },
```

Place `face.jpg` in the `public/images/` directory so Vite serves it as a
static asset.

---

## Architecture

**Scroll engine.** One pinned `<canvas>` covers the viewport for the full
scroll height. A single GSAP ScrollTrigger master timeline scrubs a normalised
`t` value from 0 to 1 as the user scrolls. The camera rig and bike path are
pure functions of `t`, making the animation deterministic and scrub-safe with
no stateful side-effects. Six segments — intro, about, drift, projects,
research, and finale — each register their camera and bike keyframes into the
master timeline independently; the segments compose without knowing about each
other.

**Procedural city.** The city is generated once at startup from a fixed seed,
so every visitor sees the same environment. A route spline defines the bike's
path through zoned districts (commercial, industrial, residential). Global
instanced meshes handle buildings (tall, medium, short, skinny, special),
billboards, traffic vehicles, a hover-car layer, a metro rail, and a far-field
skyline with a moon and ocean plane. All randomness flows through a seeded
`makeRng(seed)` utility, so nothing external (no glTF, no textures from CDN) is
required — the bundle is entirely self-contained.

**Effects and accessibility.** Visual FX include a sandevistan afterimage trail
(camera-velocity-driven), a cursor particle trail, drift skid marks and smoke,
and dynamic light pools under the bike. Below the Three.js canvas the page
continues into DOM-rendered resume sections (experience, education, skills,
contact). A reduced-motion mode replaces full animation with a static vignette
render. A screen-reader sr-only mirror of all billboard copy sits in the HTML
for accessibility. On mobile a lower geometry density tier is activated
automatically based on pixel count.
