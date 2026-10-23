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
import { gameData, type GameData } from '../data/schema';
import { SAVE_VERSION, type SaveData } from './save';
import type { GameMode } from './flow';

export type Pronouns = 'she' | 'he' | 'they';

/** Captain portrait choices (ids/colors from data/appearance.json). */
export interface Look {
  face: string;
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
  outfit: string;
  outfitColor: string;
  beard: string;
}

/** Ship paint job. */
export interface Paint {
  hull: string;
  accent: string;
  pattern: string;
  glow: string;
}

export const DEFAULT_LOOK: Look = { face: 'oval', skin: '#c08559', hair: 'short', hairColor: '#3b2416', eyes: '#6b4a2b', outfit: 'flight-jacket', outfitColor: '#2b3a55', beard: 'none' };
export const DEFAULT_PAINT: Paint = { hull: '#dfe8ff', accent: '#4fc3ff', pattern: 'plain', glow: '#ffa040' };

/** Who you are, from character creation. Ids point into data/origins.json. */
export interface Captain {
  name: string;
  pronouns: Pronouns;
  origin: string;
  moment: string;
  motive: string;
  look: Look;
}

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
  /** System ids the player has been to (shown as charted on the map). */
  visited: string[];
  /** Landing-site id the player is at, or null in space. */
  landedAt: string | null;
  captain: Captain | null;
  shipName: string;
  /** Upgrade tiers owned, by track id (missing = stock). */
  upgrades: Record<string, number>;
  /** Trade goods in the hold, by commodity id (capped by hold size). */
  cargo: Record<string, number>;
  /** Mission items, artifacts and discoveries — never fills up. */
  locker: Record<string, number>;
  /** Story flags set by conversations and missions. */
  flags: string[];
  paint: Paint;
  /** Character ids aboard your ship, in the order they joined. */
  crew: string[];
  /** Each character's approval of you (missing = 0). Per person, never a global meter. */
  affinity: Record<string, number>;
}

export const STARTING_CREDITS = 1000;
/** Nobody starts with less than this, whatever their story (you can always afford a first cargo). */
export const MIN_STARTING_CREDITS = 200;
export const STARTING_SYSTEM = 'sol';
export const STARTING_SHIP = 'prototype';
export const DEFAULT_SHIP_NAME = 'Wayfarer';
export const MAX_NAME_LENGTH = 40;
/** New games start just off Earth, in landing range, so the first thing you see is somewhere to go. */
const START_POS = { x: 780, y: -200 };

export interface NewCareer {
  captain: Captain;
  shipName: string;
  paint?: Paint;
}

/** Starting credits from your story: base + origin + defining moment, with a floor. */
export function startingCredits(captain: Captain | null, data: GameData = gameData): number {
  if (!captain) return STARTING_CREDITS;
  const origin = data.creation.origins.find((o) => o.id === captain.origin)?.credits ?? 0;
  const moment = data.creation.moments.find((m) => m.id === captain.moment)?.credits ?? 0;
  return Math.max(MIN_STARTING_CREDITS, STARTING_CREDITS + origin + moment);
}

/** Trim and clamp a typed name; empty becomes the fallback. */
export function cleanName(raw: string, fallback: string): string {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : fallback;
}

export function newGame(seed: number, now: number, career?: NewCareer): GameState {
  const captain = career?.captain ?? null;
  return {
    createdAt: now,
    rngSeed: seed >>> 0,
    credits: startingCredits(captain),
    systemId: STARTING_SYSTEM,
    mode: 'flight',
    ship: { defId: STARTING_SHIP, x: START_POS.x, y: START_POS.y, vx: 0, vy: 0, angle: -Math.PI / 2 },
    visited: [STARTING_SYSTEM],
    landedAt: null,
    captain,
    shipName: career ? cleanName(career.shipName, DEFAULT_SHIP_NAME) : DEFAULT_SHIP_NAME,
    upgrades: {},
    cargo: {},
    locker: {},
    flags: [],
    paint: { ...(career?.paint ?? DEFAULT_PAINT) },
    crew: [],
    affinity: {},
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
    visited: [...save.visited],
    landedAt: save.landedAt,
    captain: save.captain ? { ...save.captain, look: { ...save.captain.look } } : null,
    shipName: save.shipName,
    upgrades: { ...save.upgrades },
    cargo: { ...save.cargo },
    locker: { ...save.locker },
    flags: [...save.flags],
    paint: { ...save.paint },
    crew: [...save.crew],
    affinity: { ...save.affinity },
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
    visited: [...state.visited],
    landedAt: state.landedAt,
    captain: state.captain ? { ...state.captain, look: { ...state.captain.look } } : null,
    shipName: state.shipName,
    upgrades: { ...state.upgrades },
    cargo: { ...state.cargo },
    locker: { ...state.locker },
    flags: [...state.flags],
    paint: { ...state.paint },
    crew: [...state.crew],
    affinity: { ...state.affinity },
  };
}

/**
 * Content can change between updates (a station renamed, a system removed,
 * an upgrade track rebalanced). Make a loaded state consistent with the
 * current content instead of crashing. Returns what it fixed, for logging.
 * Nothing the player owns is silently destroyed: unknown cargo is kept
 * (it may come back), only clearly impossible values are clamped.
 */
export function repairAgainstContent(state: GameState, data: GameData = gameData): string[] {
  const fixed: string[] = [];
  if (!data.ships.has(state.ship.defId)) {
    fixed.push(`unknown ship "${state.ship.defId}"`);
    state.ship.defId = STARTING_SHIP;
  }
  if (!data.systems.has(state.systemId)) {
    fixed.push(`unknown system "${state.systemId}"`);
    state.systemId = STARTING_SYSTEM;
    state.ship.x = START_POS.x;
    state.ship.y = START_POS.y;
    state.landedAt = null;
  }
  if (state.landedAt !== null) {
    const spot = data.sites.get(state.landedAt);
    if (!spot || spot.systemId !== state.systemId) {
      fixed.push(`unknown landing spot "${state.landedAt}"`);
      state.landedAt = null;
    }
  }
  for (const track of data.upgrades) {
    const owned = state.upgrades[track.id] ?? 0;
    if (owned > track.tiers.length) {
      fixed.push(`upgrade "${track.id}" tier ${owned} no longer exists`);
      state.upgrades[track.id] = track.tiers.length;
    }
  }
  // Appearance options can be renamed or removed: fall back to defaults, never crash.
  const a = data.appearance;
  if (state.captain) {
    const look = state.captain.look;
    if (!a.captain.faces.some((o) => o.id === look.face)) look.face = DEFAULT_LOOK.face;
    if (!a.captain.hairStyles.some((o) => o.id === look.hair)) look.hair = DEFAULT_LOOK.hair;
    if (!a.captain.outfits.some((o) => o.id === look.outfit)) look.outfit = DEFAULT_LOOK.outfit;
    if (!a.captain.beards.some((o) => o.id === look.beard)) look.beard = DEFAULT_LOOK.beard;
  }
  if (!a.ship.patterns.some((o) => o.id === state.paint.pattern)) state.paint.pattern = DEFAULT_PAINT.pattern;
  // Crew members removed from the content (or who can no longer join) step off; approval is kept.
  const crew = state.crew.filter((id, i) => data.characters.get(id)?.home !== undefined && state.crew.indexOf(id) === i);
  if (crew.length !== state.crew.length) {
    fixed.push('crew list adjusted');
    state.crew = crew;
  }
  state.visited = state.visited.filter((id) => data.systems.has(id));
  if (!state.visited.includes(state.systemId)) state.visited.push(state.systemId);
  state.mode = state.landedAt === null ? 'flight' : 'landed';
  return fixed;
}

/** True if every part of a look is a real option (used before saving a look change). */
export function isValidLook(look: Look, data: GameData = gameData): boolean {
  const a = data.appearance.captain;
  return (
    a.faces.some((o) => o.id === look.face) &&
    a.skinTones.includes(look.skin) &&
    a.hairStyles.some((o) => o.id === look.hair) &&
    a.hairColors.includes(look.hairColor) &&
    a.eyeColors.includes(look.eyes) &&
    a.outfits.some((o) => o.id === look.outfit) &&
    a.outfitColors.includes(look.outfitColor) &&
    a.beards.some((o) => o.id === look.beard)
  );
}
