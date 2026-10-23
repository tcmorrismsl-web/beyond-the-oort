/**
 * Travel rules: jumping between systems, landing, and departing. Pure
 * functions over GameState + content data, so they are unit-tested and
 * reusable later (e.g. AI ships, mission checks).
 */
import { isLandable, type Body, type GameData } from '../data/schema';
import type { GameState } from '../core/state';

/** Ships arrive this far from the destination star, coming in from where they left. */
export const ARRIVAL_DISTANCE = 1400;
/** You can land when within the body's radius plus this margin. */
export const LANDING_MARGIN = 140;
/** Departing puts you this far beyond the body's surface. */
export const DEPART_CLEARANCE = 70;
/** Seconds the jump drive charges before the jump happens (scene handles the timer). */
export const JUMP_CHARGE_SECONDS = 1.5;

export type JumpBlock = 'unknown-system' | 'same-system' | 'not-linked' | 'landed';
export type JumpCheck = { ok: true } | { ok: false; reason: JumpBlock };

export function canJump(state: GameState, toId: string, data: GameData): JumpCheck {
  const here = data.systems.get(state.systemId);
  if (!data.systems.has(toId) || !here) return { ok: false, reason: 'unknown-system' };
  if (toId === state.systemId) return { ok: false, reason: 'same-system' };
  if (state.landedAt !== null) return { ok: false, reason: 'landed' };
  if (!here.links.includes(toId)) return { ok: false, reason: 'not-linked' };
  return { ok: true };
}

export function jumpBlockText(reason: JumpBlock): string {
  switch (reason) {
    case 'unknown-system':
      return 'Unknown destination';
    case 'same-system':
      return "You're already here";
    case 'not-linked':
      return 'No jump lane from here';
    case 'landed':
      return 'Depart before jumping';
  }
}

/**
 * Jump to a linked system. Arrive at ARRIVAL_DISTANCE from the star on the
 * side facing the system you came from, pointed at the star, at rest.
 * Returns a new state; throws if the jump isn't allowed (check canJump first).
 */
export function jump(state: GameState, toId: string, data: GameData): GameState {
  const check = canJump(state, toId, data);
  if (!check.ok) throw new Error(`jump to "${toId}" not allowed: ${check.reason}`);
  const from = data.systems.get(state.systemId);
  const to = data.systems.get(toId);
  if (!from || !to) throw new Error('unreachable: canJump verified both systems');

  const back = Math.atan2(from.y - to.y, from.x - to.x);
  return {
    ...state,
    systemId: toId,
    visited: state.visited.includes(toId) ? [...state.visited] : [...state.visited, toId],
    ship: {
      ...state.ship,
      x: Math.cos(back) * ARRIVAL_DISTANCE,
      y: Math.sin(back) * ARRIVAL_DISTANCE,
      vx: 0,
      vy: 0,
      angle: back + Math.PI,
    },
  };
}

/** The closest landable body the ship is near enough to land on, or null. */
export function landingTarget(state: GameState, data: GameData): Body | null {
  const sys = data.systems.get(state.systemId);
  if (!sys || state.landedAt !== null) return null;
  let best: Body | null = null;
  let bestGap = Infinity;
  for (const body of sys.bodies) {
    if (!isLandable(body)) continue;
    const gap = Math.hypot(state.ship.x - body.x, state.ship.y - body.y) - body.radius;
    if (gap <= LANDING_MARGIN && gap < bestGap) {
      best = body;
      bestGap = gap;
    }
  }
  return best;
}

/** Land at a site in the current system. `landedAt` holds the site id (a planet can have several). */
export function land(state: GameState, siteId: string, data: GameData): GameState {
  const spot = data.sites.get(siteId);
  if (!spot || spot.systemId !== state.systemId) {
    throw new Error(`cannot land at "${siteId}" in "${state.systemId}"`);
  }
  return {
    ...state,
    landedAt: siteId,
    ship: { ...state.ship, x: spot.body.x, y: spot.body.y, vx: 0, vy: 0 },
  };
}

/** Leave the port: appear just outside the body on the side away from the star, facing outward. */
export function depart(state: GameState, data: GameData): GameState {
  if (state.landedAt === null) return state;
  const spot = data.sites.get(state.landedAt);
  if (!spot) return { ...state, landedAt: null };
  const { body } = spot;
  const out = Math.atan2(body.y, body.x); // away from the star at 0,0
  const r = body.radius + DEPART_CLEARANCE;
  return {
    ...state,
    landedAt: null,
    ship: { ...state.ship, x: body.x + Math.cos(out) * r, y: body.y + Math.sin(out) * r, vx: 0, vy: 0, angle: out },
  };
}
