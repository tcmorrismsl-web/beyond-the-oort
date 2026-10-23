/**
 * A simple market: side income, never the point of the game. Prices come
 * from what kind of place you're at (mining camps sell ore cheap and pay
 * well for food), per-site overrides for iconic places, and a small fixed
 * per-site variation so no two markets read identically. Selling is always
 * a bit below buying, so you can't profit by trading in place.
 */
import type { Commodity, GameData } from '../data/schema';
import type { GameState } from '../core/state';
import { statsFor } from './ship';

export const CHEAP = 0.75;
export const DEAR = 1.3;
/** Sell price as a fraction of the local buy price. */
export const SELL_SPREAD = 0.88;
/** ± range of the fixed per-site variation. */
export const VARIATION = 0.12;

/** Stable 0..1 hash of a string (FNV-1a), so prices are the same every visit. */
function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

export type PriceLevel = 'cheap' | 'normal' | 'dear';

export interface Quote {
  commodity: Commodity;
  buy: number;
  sell: number;
  level: PriceLevel;
}

/** Price quote at a site, or null if the site has no market. */
export function quote(siteId: string, commodityId: string, data: GameData): Quote | null {
  const spot = data.sites.get(siteId);
  const commodity = data.commodities.get(commodityId);
  if (!spot || !commodity || !spot.site.services.includes('trade')) return null;
  const { site } = spot;
  let factor = 1;
  if (commodity.cheapAt.includes(site.kind)) factor = CHEAP;
  if (commodity.dearAt.includes(site.kind)) factor = DEAR;
  if (site.market?.cheap.includes(commodityId)) factor = CHEAP;
  if (site.market?.dear.includes(commodityId)) factor = DEAR;
  const variation = 1 + (unitHash(`${siteId}:${commodityId}`) * 2 - 1) * VARIATION;
  const buy = Math.max(1, Math.round(commodity.basePrice * factor * variation));
  const sell = Math.max(1, Math.floor(buy * SELL_SPREAD));
  const level: PriceLevel = factor < 1 ? 'cheap' : factor > 1 ? 'dear' : 'normal';
  return { commodity, buy, sell, level };
}

export function cargoUsed(state: GameState): number {
  let n = 0;
  for (const qty of Object.values(state.cargo)) n += qty;
  return n;
}

export function holdSize(state: GameState, data: GameData): number {
  return statsFor(state, data).cargo;
}

export type TradeBlock = 'no-market' | 'credits' | 'hold-full' | 'none-to-sell' | 'bad-amount';
export type TradeResult = { ok: true; state: GameState } | { ok: false; reason: TradeBlock };

export function buy(state: GameState, commodityId: string, qty: number, data: GameData): TradeResult {
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: 'bad-amount' };
  const q = state.landedAt === null ? null : quote(state.landedAt, commodityId, data);
  if (!q) return { ok: false, reason: 'no-market' };
  if (cargoUsed(state) + qty > holdSize(state, data)) return { ok: false, reason: 'hold-full' };
  const cost = q.buy * qty;
  if (state.credits < cost) return { ok: false, reason: 'credits' };
  return {
    ok: true,
    state: { ...state, credits: state.credits - cost, cargo: { ...state.cargo, [commodityId]: (state.cargo[commodityId] ?? 0) + qty } },
  };
}

export function sell(state: GameState, commodityId: string, qty: number, data: GameData): TradeResult {
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: 'bad-amount' };
  const q = state.landedAt === null ? null : quote(state.landedAt, commodityId, data);
  if (!q) return { ok: false, reason: 'no-market' };
  const have = state.cargo[commodityId] ?? 0;
  if (have < qty) return { ok: false, reason: 'none-to-sell' };
  // Drop the entry entirely when sold out, so the hold lists only what you carry.
  const cargo = Object.fromEntries(Object.entries(state.cargo).filter(([k]) => k !== commodityId));
  if (have > qty) cargo[commodityId] = have - qty;
  return { ok: true, state: { ...state, credits: state.credits + q.sell * qty, cargo } };
}

/** The most of a commodity you could buy right now (credits and hold space). */
export function maxBuyable(state: GameState, commodityId: string, data: GameData): number {
  const q = state.landedAt === null ? null : quote(state.landedAt, commodityId, data);
  if (!q) return 0;
  return Math.max(0, Math.min(Math.floor(state.credits / q.buy), holdSize(state, data) - cargoUsed(state)));
}

export function tradeBlockText(reason: TradeBlock): string {
  switch (reason) {
    case 'no-market':
      return 'No market here';
    case 'credits':
      return 'Not enough credits';
    case 'hold-full':
      return 'Hold is full';
    case 'none-to-sell':
      return "You don't have any";
    case 'bad-amount':
      return 'Invalid amount';
  }
}
