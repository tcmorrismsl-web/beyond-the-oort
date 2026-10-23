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

export interface Walker {
  x: number;
  y: number;
  /** Facing angle in radians (for the sprite). */
  facing: number;
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
 * One fixed step of walking. Moves each axis separately so you slide along
 * walls instead of sticking to them. `throttle` 0..1, `angle` null = stand still.
 */
export function stepWalker(w: Walker, throttle: number, angle: number | null, dt: number, map: readonly string[]): Walker {
  if (angle === null || throttle <= 0) return w;
  const dist = WALK_SPEED * Math.min(1, throttle) * dt;
  // Sub-steps keep fast movement from tunnelling through thin walls.
  const steps = Math.max(1, Math.ceil(dist / (BODY_RADIUS * 0.5)));
  const sx = (Math.cos(angle) * dist) / steps;
  const sy = (Math.sin(angle) * dist) / steps;
  let { x, y } = w;
  for (let i = 0; i < steps; i += 1) {
    if (!blocked(map, x + sx, y)) x += sx;
    if (!blocked(map, x, y + sy)) y += sy;
  }
  return { x, y, facing: angle };
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
