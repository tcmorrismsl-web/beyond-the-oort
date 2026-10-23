/**
 * The single source of truth for a playthrough. Every mode (flight, landed,
 * on-foot) reads and writes this one object, so switching modes can never
 * lose or duplicate anything. It converts to and from the versioned save.
 *
 * Rule: if it's in the save, it's in state. Things in state that are NOT
 * saved are listed here on purpose:
 *  - `mode`: derived on load — landed if `landedAt` is set, else flight
 *    (on-foot is never resumed mid-scene; it resumes landed/flight).
 *  - ship velocity: resuming at rest avoids drifting into danger on load.
 */
import { gameData } from '../data/schema';
import { SAVE_VERSION, type SaveData } from './save';
import type { GameMode } from './flow';

export interface GameState {
  createdAt: number;
  rngSeed: number;
  credits: number;
  systemId: string;
  mode: GameMode;
  ship: {
    defId: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
  };
  fuel: number;
  /** System ids the player has been to (shown as charted on the map). */
  visited: string[];
  /** Landing-site id the player is at, or null in space. */
  landedAt: string | null;
}

export const STARTING_CREDITS = 1000;
export const STARTING_SYSTEM = 'sol';
export const STARTING_SHIP = 'shuttle';

/** Full-tank fuel for a ship type (content data), with a safe fallback. */
export function maxFuel(defId: string): number {
  return gameData.ships.get(defId)?.fuel ?? 3;
}

export function newGame(seed: number, now: number): GameState {
  return {
    createdAt: now,
    rngSeed: seed >>> 0,
    credits: STARTING_CREDITS,
    systemId: STARTING_SYSTEM,
    mode: 'flight',
    // Start just off Earth so the first thing you see is somewhere to land.
    ship: { defId: STARTING_SHIP, x: 780, y: -200, vx: 0, vy: 0, angle: -Math.PI / 2 },
    fuel: maxFuel(STARTING_SHIP),
    visited: [STARTING_SYSTEM],
    landedAt: null,
  };
}

export function fromSave(save: SaveData): GameState {
  return {
    createdAt: save.createdAt,
    rngSeed: save.rngSeed,
    credits: save.credits,
    systemId: save.systemId,
    mode: save.landedAt === null ? 'flight' : 'landed',
    ship: { defId: save.ship.defId, x: save.ship.x, y: save.ship.y, vx: 0, vy: 0, angle: save.ship.angle },
    fuel: save.fuel,
    visited: [...save.visited],
    landedAt: save.landedAt,
  };
}

export function toSave(state: GameState, now: number): SaveData {
  return {
    version: SAVE_VERSION,
    createdAt: state.createdAt,
    updatedAt: now,
    rngSeed: state.rngSeed,
    credits: state.credits,
    systemId: state.systemId,
    ship: { defId: state.ship.defId, x: state.ship.x, y: state.ship.y, angle: state.ship.angle },
    fuel: state.fuel,
    visited: [...state.visited],
    landedAt: state.landedAt,
  };
}

/**
 * Content can change between updates (a station renamed, a system removed).
 * Make a loaded state consistent with the current content instead of
 * crashing: unknown ship → starter ship; unknown system → start system;
 * a landing spot that no longer exists (or isn't in this system) → in flight.
 * Returns the problems it fixed, for logging.
 */
export function repairAgainstContent(state: GameState): string[] {
  const fixed: string[] = [];
  if (!gameData.ships.has(state.ship.defId)) {
    fixed.push(`unknown ship "${state.ship.defId}"`);
    state.ship.defId = STARTING_SHIP;
  }
  if (!gameData.systems.has(state.systemId)) {
    fixed.push(`unknown system "${state.systemId}"`);
    state.systemId = STARTING_SYSTEM;
    state.ship.x = 780;
    state.ship.y = -200;
    state.landedAt = null;
  }
  if (state.landedAt !== null) {
    const spot = gameData.sites.get(state.landedAt);
    if (!spot || spot.systemId !== state.systemId) {
      fixed.push(`unknown landing spot "${state.landedAt}"`);
      state.landedAt = null;
    }
  }
  state.visited = state.visited.filter((id) => gameData.systems.has(id));
  if (!state.visited.includes(state.systemId)) state.visited.push(state.systemId);
  state.fuel = Math.min(Math.max(0, Math.floor(state.fuel)), maxFuel(state.ship.defId));
  state.mode = state.landedAt === null ? 'flight' : 'landed';
  return fixed;
}
