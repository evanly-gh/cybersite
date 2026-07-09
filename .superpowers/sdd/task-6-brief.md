### Task 6: Route spline + segment map

**Files:**
- Create: `src/world/route.ts`, `tests/route.test.ts`

**Interfaces:**
- Produces:
  - `WAYPOINTS` (named, exact):
    `introStart (-300, 0, 0)`, `aboutStart (-260, 0, 0)`, `aboutEnd (200, 0, 0)`, `shibuyaCenter (240, 0, 0)`, `driftExit (240, 0, -30)`, `ramp1Base (240, 0, -90)`, `ramp1Land (240, 0, -170)`, `ramp2Base (240, 0, -260)`, `ramp2Land (240, 0, -330)`, `skywayStart (240, 0, -420)`, `skywayTop (240, 28, -520)`, `skywayEnd (240, 28, -800)`, `bridgeStart (240, 14, -860)`, `bridgeEnd (240, 12, -1400)`. Bike travels +X along About street, turns right at Shibuya onto −Z.
  - `ROUTE: THREE.CatmullRomCurve3` through the waypoints (`curveType 'centripetal'`).
  - `ROUTE_U: Record<keyof typeof WAYPOINTS, number>` — the arc-length parameter `u∈[0,1]` of each waypoint (computed once via nearest-point sampling at 4096 samples).
  - `MOON_POS = new THREE.Vector3(240, 260, -2600)`, `MOON_RADIUS = 320`.
  - `roadFrame(u: number): { pos: V3; tangent: V3; normal: V3; binormal: V3 }` (Y-up-projected Frenet-like frame; binormal = tangent × up, re-orthogonalized — used by streets, traffic lanes, bike path).

- [ ] **Step 1: Failing tests** — total route length in `[1650, 1950]` m; `ROUTE.getPointAt(ROUTE_U.shibuyaCenter)` within 8 m of `(240,0,0)`; y at `ROUTE_U.skywayEnd` within 1 m of 28; `roadFrame(u).binormal` unit-length and ⟂ tangent for 20 sampled u.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Viewer check** — register `routeDebug` (TubeGeometry along ROUTE, radius 0.5, emissive cyan + waypoint marker spheres labeled via small canvas sprites); shoot 4 angles; confirm the L-shaped route with ramp bumps and skyway climb reads correctly.
- [ ] **Step 6: Commit** — `feat: authored city route spline with named waypoints`

