/**
 * The single source of truth for a playthrough. Every mode (flight, landed,
 * on-foot) reads and writes this one object, so switching modes can never
 * lose or duplicate anything. It converts to and from the versioned save.
 *
 * Rule: if it's in the save, it's in state. Things in state that are NOT
 * saved are listed here on purpose:
 *  - `mode`: a loaded game always resumes in flight for now (the safest
 *    place to drop a player); revisit when landing exists.
 *  - ship velocity: resuming at rest avoids drifting into danger on load.
 */
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
}

export const STARTING_CREDITS = 1000;
export const STARTING_SYSTEM = 'sol';
export const STARTING_SHIP = 'shuttle';

export function newGame(seed: number, now: number): GameState {
  return {
    createdAt: now,
    rngSeed: seed >>> 0,
    credits: STARTING_CREDITS,
    systemId: STARTING_SYSTEM,
    mode: 'flight',
    ship: { defId: STARTING_SHIP, x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2 },
  };
}

export function fromSave(save: SaveData): GameState {
  return {
    createdAt: save.createdAt,
    rngSeed: save.rngSeed,
    credits: save.credits,
    systemId: save.systemId,
    mode: 'flight',
    ship: { defId: save.ship.defId, x: save.ship.x, y: save.ship.y, vx: 0, vy: 0, angle: save.ship.angle },
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
  };
}
