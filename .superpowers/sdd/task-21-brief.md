### Task 21: Traffic system

**Files:**
- Create: `src/choreography/traffic.ts`

**Interfaces:**
- Consumes: vehicle builders (Tasks 14–15), `roadFrame`, waypoints.
- Produces: `buildTraffic(rng): { group; update(t: number): void }`. Lane spec data: About street 2+2 lanes, boulevard 2+2, skyway 1+1, bridge 2+2 sparse; hover lanes: 2 sky paths (y 22–34, gentle S-curves above each street) + 1 street-level hover lane on the boulevard.
- Car mix per lane spawn table: cheap 40%, average 40%, luxury 20%.

- [ ] **Step 1: Lane engine** — each lane = offset curve of the street spline (`roadFrame` binormal × laneOffset); each vehicle: `u(t) = (u0 + t * laneSpeed) % 1` — deterministic, scrub-safe; same-direction lanes move at 0.25–0.4× the bike's average progress rate (biker visibly overtakes, per spec); oncoming lanes faster relative. ~26 ground cars + 5 hovers total (instancing NOT used — each is a built group; keep count modest for draw calls; reuse: max 2 unique builds per type, cloned).
- [ ] **Step 2: Vehicle behavior** — cars: wheel spin ∝ lane speed, slight lane wobble (per-car seeded sine, ±0.15 m), headlights on; hover cars: bob via their `update`, sky lanes weave between building gaps. No collision logic (lanes are exclusive slots with spaced u0) — verify no visual overlap by spacing u0 ≥ 0.06 apart per lane.
- [ ] **Step 3: Verify** — `?cam=` shots at 3 t values (0.15, 0.45, 0.9) — cars present on all streets, no interpenetration, tail-light streams read well at distance. Iterate: add 1–2 parked cars at curbs (static, cheap tier), one pulled-over taxi hover at Shibuya.
- [ ] **Step 4: Commit** — `feat(choreography): deterministic scrub-safe traffic on ground + sky lanes`

---

# Phase 4 — FX

