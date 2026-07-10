# Full-Ride Critique — Pass 1 (2026-07-10)

Swept the real scroll timeline (`?shot=`) at 20 points, 0→1.0. Draw calls confirmed <300 everywhere (Task 33). Findings below, most-severe first.

## CRITICAL

### C1 — Finale over-bloomed (t 0.85–0.95)
Frames city-bridge-finale.png at 0.85/0.90/0.95 wash almost entirely to white/teal. The moon is a featureless blown-white blob (no crater/gradient detail), the bridge cyan edge-light strips are pure-white lines, and the closing type "EVAN LI — PORTFOLIO 2026" is barely legible against the glare. This contradicts the "wallpaper quality" bar. t=1.0 recovers (bike silhouette reads against moon) because the camera has pulled back far enough. Root cause: moon MeshBasicMaterial + additive glow sprite + bridge edge-light emissive + bloom compound; even at BLOOM_PEAK 1.1 the raw scene brightness at these camera distances blows out. Fix: reduce the moon's emissive/glow-sprite intensity and/or the bridge edge-light strip emissive so the finale reads with structure, not glare. The moon should show as a disc with a soft halo, not a supernova. Verify at 0.85/0.90/0.95 the moon has a visible edge and the closing type is legible.

## IMPORTANT

### I1 — Intro subtitle wrong content (t=0)
The intro title panel subtitle reads "FULL-STACK · SYSTEMS". Evan is ML Systems / on-device inference, NOT full-stack. Should reflect RESUME.tagline ("CS + Economics @ UW — ML Systems / On-Device Inference") or a tight variant like "ML SYSTEMS · EDGE INFERENCE". Source from RESUME, don't hardcode a wrong generic string. (File: src/choreography/segments/intro.ts drawIntroPanel.)

### I2 — Research panels not visible (t 0.66–0.72)
The research section is supposed to showcase 2 large floating holo-panels (Mobile Intelligence Lab, LLM Hardware Benchmarking) drifting past the leading camera. At 0.66 and 0.72 only the bike + skyway rails + background buildings are visible — the panels never enter frame. The leading-camera framing (biker centered, camera ahead looking back) may be pointing away from where the panels are mounted, or the panels are positioned outside the view frustum. Fix: ensure at least one research panel is fully readable in-frame for a stretch of the research window (brief Task 29 requires each panel readable ≥3 consecutive shots). May require repositioning panels into the leading camera's view or adjusting the camera. (File: src/choreography/segments/research.ts.)

### I3 — Drift composition weak (t 0.33)
At the signature Shibuya drift, the right ~40% of frame is a dark building face the camera grazes, and the biker + sandevistan fan are not clearly visible. The drift is the hero moment of the Shibuya section; the biker mid-drift with the ghost fan should be the focal point against the crossing/crowd/neon. Fix: adjust the drift camera (Task 27) so the biker + sandevistan are clearly framed against the neon crossing, not occluded by a foreground building. (File: src/choreography/segments/drift.ts.)

### I4 — Projects composition weak (t 0.44)
Mid-backflip, the biker is a tiny speck and the project holo text (TTT-E2E / RememberMe) is small and not prominent. The negative-space concept works structurally but the displays don't read as the focus. Fix: bring the project displays larger/closer or tighten the side camera so the project content + arcing biker both read clearly. (File: src/choreography/segments/projects.ts.) [Lower priority than C1/I1/I2.]

## MINOR

### M1 — Intro title panel clips a building (t=0)
The "EVAN LI" title panel overlaps/clips a foreground building at the intro overhead pose. Cosmetic; nudge panel position or camera. (File: src/choreography/segments/intro.ts / Task 25.)

---

## Fix priority for this pass
1. C1 finale bloom (most visible quality problem)
2. I1 intro subtitle (factual content error, easy)
3. I2 research panels (content not showcased)
4. I3 drift composition
5. I4 projects composition + M1 title clip (if time)
