/**
 * Task 27 — Drift segment (Shibuya crossing, t 0.28 – 0.38)
 *
 * The bike takes the 90° right turn at the Shibuya-style crossing as a drift:
 * over-rotated yaw, deep lean into the turn, rear-wheel lateral slide, then an
 * exit counter-lean wobble (2 damped oscillations).
 *
 * While the drift unfolds, the camera swings WIDE outside the corner (to the
 * +Z side, outside a +X→−Z right turn) so the mega-screens, crowd, and the
 * diagonal crossing pattern fill the background.
 *
 * ## Geometry reminder
 *   shibuyaCenter = (240, 0,   0)     — start of the corner arc
 *   driftExit     = (240, 0, -30)     — end of the drift slide
 *   ramp1Base     = (240, 0, -90)     — boulevard target
 *
 * ## Drift override parameters (match driftFx DRIFT_WINDOW)
 *   t0 = 0.30, t1 = 0.345
 *   oversteerDeg = 28   (front slides outward, decays to 0 at t1)
 *   leanDeg      = 33   (into the turn, positive = lean right for a right turn)
 *   slideM       = 0.4  (rear-wheel outboard slide)
 *   wobbleCycles = 2    (2 damped counter-lean oscillations after t1)
 *   wobbleDuration = 0.02
 *
 * ## Camera keys
 *   t = 0.28   – approach chase: arriving on the About street
 *   t = 0.29   – swing start: begin pulling wide to +Z side
 *   t = 0.30   – wide OUTSIDE shot: camera at (270, 4, 50), looking across
 *                 intersection toward (230, 1, -15) — mega-screens + crowd + crossing
 *   t = 0.33   – hold wide mid-drift (duplicate key to kill Catmull-Rom tangent)
 *   t = 0.35   – begin settling back to rear chase
 *   t = 0.36   – low rear chase: (240, 1.4, 20), looking toward ramp (240, 1.2, -90), fov 66
 *   t = 0.38   – hold low chase (duplicate to stabilise exit frame)
 */

import * as THREE from 'three';
import type { CameraRig } from '../cameraRig';
import type { BikePath } from '../bikePath';
import { ROUTE_U } from '../../world/route';
import { DRIFT_WINDOW } from '../../fx/driftFx';

// ---------------------------------------------------------------------------
// Ease helpers
// ---------------------------------------------------------------------------

function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DriftSegmentOptions {
  rig: CameraRig;
  bike: BikePath;
}

/**
 * Registers the Shibuya drift segment:
 *  - Bike speed keys for the approach + corner arc + exit
 *  - Drift override window on bikePath (yaw, lean, slide, wobble)
 *  - Camera keys: approach chase → wide outside corner → low exit chase
 */
export function registerDriftSegment(opts: DriftSegmentOptions): void {
  const { rig, bike } = opts;

  // ---- Bike speed keys ----
  // The route already curves from shibuyaCenter (240,0,0) to driftExit (240,0,-30)
  // to ramp1Base (240,0,-90).  We map scroll t linearly across those u values.
  //
  //   t 0.28 – start of the segment (about segment ended here)
  //   t 0.30 – drift override kicks in (matches driftFx DRIFT_WINDOW.tStart)
  //   t 0.345 – drift override ends   (matches driftFx DRIFT_WINDOW.tEnd)
  //   t 0.38 – segment end (bike at ramp1Base, ready for ramp segment)
  //
  // Speed: approach fast (0.28–0.30), through-turn moderate pace (0.30–0.345),
  // steady exit to ramp1Base (0.345–0.38).
  bike.addSpeedKeys([
    { t: 0.28, u: ROUTE_U.aboutEnd + 0.01 },      // just past the About segment end
    { t: 0.30, u: ROUTE_U.shibuyaCenter },         // at the corner apex — drift starts
    { t: 0.345, u: ROUTE_U.driftExit },            // cleared the corner arc
    { t: 0.38, u: ROUTE_U.ramp1Base }              // onto the boulevard, ramp ahead
  ]);

  // ---- Drift override window ----
  // Synchronised with driftFx.DRIFT_WINDOW so skid arcs + smoke align with
  // the bike's over-rotated heading and lateral slide.
  bike.addDriftWindow({
    t0: DRIFT_WINDOW.tStart,          // 0.30
    t1: DRIFT_WINDOW.tEnd,            // 0.345
    oversteerDeg: 28,                 // front slides outward (right-turn oversteer)
    leanDeg: 33,                      // into the turn (positive lean right)
    slideM: 0.4,                      // rear-wheel outboard displacement
    wobbleCycles: 2,                  // 2 damped counter-lean oscillations
    wobbleDuration: 0.02,             // settles by t = 0.365
    wobbleAmp: 0.4                    // 40% of leanDeg as wobble amplitude
  });

  // ---- Camera keys ----
  // The Shibuya crossing sits at world (240, 0, 0).  Outside of the right turn
  // (+X → −Z) is the +Z side.  We swing the camera to +Z and look back across
  // the intersection diagonally so the mega-screens on the south-east corner,
  // the crowd at the crossing, and the diagonal zebra stripes all fill the frame.
  //
  // Approach (t 0.28): the about segment's last key hands off to a chase ~10m
  // behind the bike.  The about segment's t=0.28 key is at (150,10,9) looking
  // at (200,4,-5) — we transition from that to our approach chase.
  //
  // t 0.29: approach chase — directly behind the bike as it heads down the
  //          About street toward the intersection.  Camera ~8m behind the bike
  //          which is near x=220 at t=0.29, heading +X.
  //          pos=(210, 2.5, 4), look=(240, 1, -5), fov=65 (speed feel)
  //
  // t 0.30: begin swing wide — camera starts moving to +Z outside the corner.
  //          pos=(260, 3.5, 30), look=(235, 1, -5), fov=68
  //
  // t 0.315: WIDE outside shot — deepest camera swing, +Z side.
  //           Camera at (270, 4, 50), looking at (230, 1, -15) — this frames
  //           the crossing diagonal, crowds, and mega-screens in a panoramic view.
  //           fov=72 (slightly wide to capture the full scene breadth)
  //
  // t 0.33:  Hold wide mid-drift (duplicate key to kill Catmull-Rom tangent overshoot)
  //           Same pose as t=0.315 to flatten the spline through the hold.
  //
  // t 0.35:  Begin settling — camera descends and swings back behind the bike
  //           which is now heading -Z on the boulevard.
  //           pos=(245, 2.5, 10), look=(240, 1.5, -40), fov=68
  //
  // t 0.36:  Low rear chase — camera 20m behind (bike is at ~z=-30 heading -Z,
  //           camera at z=+20, low 1.4m height).
  //           pos=(240, 1.4, 20), look=(240, 1.2, -90), fov=66
  //
  // t 0.38:  Hold exit frame (ramp1Base dead ahead).
  //           Same pose to stabilise the shot.

  // WIDE pose (mid-drift): camera outside the corner on +Z side
  const widePos  = new THREE.Vector3(270, 4, 50);
  const wideLook = new THREE.Vector3(230, 1, -15);

  // Low chase pose (exit): camera 10m past crossing (z=−10) on the boulevard,
  // 1.4m height, looking deep down the boulevard toward the ramp.
  const chasePos  = new THREE.Vector3(243, 1.4, -10);
  const chaseLook = new THREE.Vector3(241, 1.0, -140);

  rig.addKeys([
    // Anchor key at t=0.28 matching the about segment's last pose (shared boundary).
    // This gives Catmull-Rom a stable km1 so the spline doesn't shoot through
    // buildings during the first 0.28→0.29 interpolation.
    {
      t: 0.28,
      pose: {
        pos: new THREE.Vector3(150, 10, 9),
        look: new THREE.Vector3(200, 4, -5),
        fov: 60,
        roll: 0
      }
    },
    // Approach: behind the bike as it nears the intersection
    {
      t: 0.29,
      pose: {
        pos: new THREE.Vector3(205, 4, 8),
        look: new THREE.Vector3(240, 1.5, 0),
        fov: 65,
        roll: 0
      },
      ease: easeInOutQuad
    },
    // Deepest wide shot — outside corner, mega-screens / crowd / crossing in frame
    // Camera on +Z side of the intersection (outside a +X→−Z right turn)
    {
      t: 0.315,
      pose: {
        pos: widePos.clone(),
        look: wideLook.clone(),
        fov: 72,
        roll: 0
      },
      ease: easeInOutQuad
    },
    // Hold wide (duplicate key to flatten Catmull-Rom tangents through mid-drift)
    {
      t: 0.33,
      pose: {
        pos: widePos.clone(),
        look: wideLook.clone(),
        fov: 72,
        roll: 0
      }
    },
    // Settling — camera swings back, descends toward boulevard level
    {
      t: 0.35,
      pose: {
        pos: new THREE.Vector3(248, 3, 6),
        look: new THREE.Vector3(240, 1.5, -60),
        fov: 68,
        roll: 0
      },
      ease: easeInOutQuad
    },
    // Low rear chase: ramp1Base dead ahead, speed feel fov
    // Camera is 10m past the crossing (z=−10), 1.4m high, looking down the boulevard
    {
      t: 0.36,
      pose: {
        pos: chasePos.clone(),
        look: chaseLook.clone(),
        fov: 66,
        roll: 0
      },
      ease: easeInOutQuad
    },
    // Hold exit frame (bike clears wobble by t=0.365, exits clean)
    {
      t: 0.38,
      pose: {
        pos: chasePos.clone(),
        look: chaseLook.clone(),
        fov: 66,
        roll: 0
      }
    }
  ]);
}
