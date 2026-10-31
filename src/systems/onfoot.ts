/**
 * Walking around on foot, top-down, as pure functions (no Phaser): moving
 * against walls, what's within reach, and which conversation a spot plays.
 * Units are tiles (1 tile = TILE_PX pixels on screen) and seconds.
 */
import { TILE_SOLID, type Dialogue, type Entry, type GameData, type Interior } from '../data/schema';
import type { GameState } from '../core/state';
import { conditionMet } from './dialogue';

export const TILE_PX = 40;
/** Walking speed at full stick, tiles per second. */
export const WALK_SPEED = 3.6;
/** Body radius in tiles (keeps you from clipping corners). */
export const BODY_RADIUS = 0.28;
/** How close (tiles) you must be to look at a spot, talk to someone, or leave. */
export const REACH = 1.15;

/** How quickly you reach walking speed, and come to a stop (per second; higher = snappier). */
export const ACCEL = 9;
export const DECEL = 12;
/** How fast you turn to face where you're going (radians per second). */
export const TURN_RATE = 11;
/** Distance covered by one full walk cycle (left step + right step), in tiles. */
export const STRIDE = 1.4;
/** Below this speed (tiles/s) you're standing still. */
export const REST_SPEED = 0.05;

export interface Walker {
  x: number;
  y: number;
  /** Facing angle in radians (for the sprite). */
  facing: number;
  /** Velocity in tiles per second (eases toward the stick, so starts and stops take a beat). */
  vx?: number;
  vy?: number;
  /** Walk-cycle phase, 0..1, advanced by distance actually covered (feet never slide). */
  stride?: number;
}

/** Shortest signed angle from a to b. */
function turnToward(from: number, to: number, maxStep: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

export function solidAt(map: readonly string[], tx: number, ty: number): boolean {
  const ch = map[ty]?.[tx];
  return ch === undefined || TILE_SOLID[ch] !== false;
}

/** True if a circle of BODY_RADIUS at (x, y) overlaps any solid tile. */
export function blocked(map: readonly string[], x: number, y: number): boolean {
  const r = BODY_RADIUS;
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty += 1) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx += 1) {
      if (!solidAt(map, tx, ty)) continue;
      // Closest point of the tile to the circle center.
      const cx = Math.max(tx, Math.min(x, tx + 1));
      const cy = Math.max(ty, Math.min(y, ty + 1));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  }
  return false;
}

/**
 * One fixed step of walking. Speed eases toward the stick (a beat to get
 * going, a beat to stop), you turn smoothly to face where you're moving, and
 * the walk cycle advances by the distance you actually covered, so feet stay
 * planted. Moves each axis separately so you slide along walls instead of
 * sticking to them. `throttle` 0..1, `angle` null = no input.
 */
export function stepWalker(w: Walker, throttle: number, angle: number | null, dt: number, map: readonly string[]): Walker {
  const vx0 = w.vx ?? 0;
  const vy0 = w.vy ?? 0;
  const moving = angle !== null && throttle > 0;
  if (!moving && Math.hypot(vx0, vy0) < REST_SPEED) return vx0 === 0 && vy0 === 0 ? w : { ...w, vx: 0, vy: 0 };
  const speed = moving ? WALK_SPEED * Math.min(1, throttle) : 0;
  const tx = moving ? Math.cos(angle) * speed : 0;
  const ty = moving ? Math.sin(angle) * speed : 0;
  const k = Math.min(1, (moving ? ACCEL : DECEL) * dt);
  let vx = vx0 + (tx - vx0) * k;
  let vy = vy0 + (ty - vy0) * k;
  const dist = Math.hypot(vx, vy) * dt;
  // Sub-steps keep fast movement from tunnelling through thin walls.
  const steps = Math.max(1, Math.ceil(dist / (BODY_RADIUS * 0.5)));
  const sx = (vx * dt) / steps;
  const sy = (vy * dt) / steps;
  let { x, y } = w;
  for (let i = 0; i < steps; i += 1) {
    if (!blocked(map, x + sx, y)) x += sx;
    else vx = 0;
    if (!blocked(map, x, y + sy)) y += sy;
    else vy = 0;
  }
  const covered = Math.hypot(x - w.x, y - w.y);
  const heading = moving ? angle : Math.atan2(vy, vx);
  const facing = covered > 0 || moving ? turnToward(w.facing, heading, TURN_RATE * dt) : w.facing;
  return { x, y, facing, vx, vy, stride: ((w.stride ?? 0) + covered / STRIDE) % 1 };
}

/**
 * Pose for drawing a walker: how far each foot is ahead (+) or behind (-) of
 * the body, how far each hand swings (opposite to its foot), and a small bob.
 * `amount` 0..1 fades the stride in and out with speed so you don't freeze mid-step.
 */
export interface Pose {
  leftFoot: number;
  rightFoot: number;
  leftHand: number;
  rightHand: number;
  bob: number;
}

export function walkPose(stride: number, speed: number): Pose {
  const amount = Math.min(1, speed / (WALK_SPEED * 0.6));
  const s = Math.sin(stride * Math.PI * 2) * amount;
  return { leftFoot: s, rightFoot: -s, leftHand: -s * 0.8, rightHand: s * 0.8, bob: Math.abs(Math.cos(stride * Math.PI * 2)) * amount };
}

export interface Reachable {
  kind: 'spot' | 'person' | 'exit';
  id: string; // spot id (people talk at their spot), or 'exit'
  label: string;
  x: number;
  y: number;
}

/** People standing in this place right now. */
export function peopleHere(inside: Interior, state: GameState): Interior['people'] {
  return inside.people.filter((p) => conditionMet(p.if, state));
}

/** The conversation a spot plays right now: the first one placed there whose condition holds. */
export function dialogueAtSpot(interiorId: string, spotId: string, dialogues: ReadonlyMap<string, Dialogue>, state: GameState): Dialogue | null {
  for (const d of dialogues.values()) {
    if (d.spot?.interior === interiorId && d.spot.id === spotId && conditionMet(d.if, state)) return d;
  }
  return null;
}

/** Everything within reach, nearest first. Spots with nothing to say right now are skipped. */
export function withinReach(inside: Interior, w: Walker, state: GameState, data: GameData): Reachable[] {
  const out: (Reachable & { d: number })[] = [];
  const near = (x: number, y: number): number => Math.hypot(x - w.x, y - w.y);
  for (const p of peopleHere(inside, state)) {
    const d = near(p.x, p.y);
    if (d <= REACH && dialogueAtSpot(inside.id, p.spot, data.dialogues, state)) {
      const who = data.characters.get(p.character);
      out.push({ kind: 'person', id: p.spot, label: who ? `Talk · ${who.name}` : 'Talk', x: p.x, y: p.y, d });
    }
  }
  for (const s of inside.spots) {
    if (s.auto) continue;
    const d = near(s.x, s.y);
    if (d <= REACH && dialogueAtSpot(inside.id, s.id, data.dialogues, state)) out.push({ kind: 'spot', id: s.id, label: s.label, x: s.x, y: s.y, d });
  }
  const e = near(inside.exit.x, inside.exit.y);
  if (e <= REACH) out.push({ kind: 'exit', id: 'exit', label: inside.exit.label, x: inside.exit.x, y: inside.exit.y, d: e });
  return out.sort((a, b) => a.d - b.d).map((r) => ({ kind: r.kind, id: r.id, label: r.label, x: r.x, y: r.y }));
}

/** An auto spot you're standing on that has something to play (e.g. the moment you step aboard). */
export function autoSpotAt(inside: Interior, w: Walker, state: GameState, data: GameData): string | null {
  for (const s of inside.spots) {
    if (s.auto && Math.hypot(s.x - w.x, s.y - w.y) <= REACH && dialogueAtSpot(inside.id, s.id, data.dialogues, state)) return s.id;
  }
  return null;
}

/** Whether an entry (from a site or a point of interest) is open right now. */
export function entryOpen(entry: Entry | undefined, state: GameState): entry is Entry {
  return entry !== undefined && conditionMet(entry.if, state);
}
