/**
 * Your one legendary ship: stock stats + upgrades bought tier by tier at
 * drydocks. No slots, no swapping parts — each track just gets better.
 * Pure functions over state + content, unit-tested.
 */
import type { GameData, ShipDef, UpgradeTrack } from '../data/schema';
import type { GameState } from '../core/state';

export interface ShipStats {
  thrust: number;
  maxSpeed: number;
  turnRate: number;
  drag: number;
  cruiseMultiplier: number;
  cargo: number;
  hull: number;
  shields: number;
}

/** Stock stats with every owned upgrade applied (each tier's effect replaces the tier below it). */
export function shipStats(def: ShipDef, upgrades: Readonly<Record<string, number>>, tracks: readonly UpgradeTrack[]): ShipStats {
  const s: ShipStats = {
    thrust: def.thrust,
    maxSpeed: def.maxSpeed,
    turnRate: def.turnRate,
    drag: def.drag,
    cruiseMultiplier: def.cruiseMultiplier,
    cargo: def.cargo,
    hull: def.hull,
    shields: def.shields,
  };
  for (const track of tracks) {
    const owned = Math.min(upgrades[track.id] ?? 0, track.tiers.length);
    const tier = owned > 0 ? track.tiers[owned - 1] : undefined;
    if (!tier) continue;
    const e = tier.effect;
    if (e.thrust !== undefined) s.thrust = def.thrust * e.thrust;
    if (e.maxSpeed !== undefined) s.maxSpeed = def.maxSpeed * e.maxSpeed;
    if (e.turnRate !== undefined) s.turnRate = def.turnRate * e.turnRate;
    if (e.cruiseMultiplier !== undefined) s.cruiseMultiplier = Math.max(def.cruiseMultiplier, e.cruiseMultiplier);
    if (e.cargo !== undefined) s.cargo = def.cargo + e.cargo;
    if (e.hull !== undefined) s.hull = def.hull + e.hull;
    if (e.shields !== undefined) s.shields = def.shields + e.shields;
  }
  return s;
}

export function statsFor(state: GameState, data: GameData): ShipStats {
  const def = data.ships.get(state.ship.defId);
  if (!def) throw new Error(`ship "${state.ship.defId}" missing from data`);
  return shipStats(def, state.upgrades, data.upgrades);
}

export type UpgradeBlock = 'unknown' | 'maxed' | 'credits' | 'no-drydock';
export type UpgradeCheck = { ok: true; tier: number; cost: number } | { ok: false; reason: UpgradeBlock };

/** Can you buy the next tier of this track here? (You must be landed at a drydock.) */
export function canUpgrade(state: GameState, trackId: string, data: GameData): UpgradeCheck {
  const track = data.upgrades.find((t) => t.id === trackId);
  if (!track) return { ok: false, reason: 'unknown' };
  const site = state.landedAt === null ? undefined : data.sites.get(state.landedAt);
  if (!site?.site.services.includes('drydock')) return { ok: false, reason: 'no-drydock' };
  const owned = state.upgrades[trackId] ?? 0;
  const next = track.tiers[owned];
  if (!next) return { ok: false, reason: 'maxed' };
  if (state.credits < next.cost) return { ok: false, reason: 'credits' };
  return { ok: true, tier: owned + 1, cost: next.cost };
}

export function upgrade(state: GameState, trackId: string, data: GameData): GameState {
  const check = canUpgrade(state, trackId, data);
  if (!check.ok) throw new Error(`upgrade "${trackId}" not allowed: ${check.reason}`);
  return { ...state, credits: state.credits - check.cost, upgrades: { ...state.upgrades, [trackId]: check.tier } };
}

export function upgradeBlockText(reason: UpgradeBlock): string {
  switch (reason) {
    case 'unknown':
      return 'Unknown upgrade';
    case 'maxed':
      return 'Fully upgraded';
    case 'credits':
      return 'Not enough credits';
    case 'no-drydock':
      return 'Needs a drydock';
  }
}
