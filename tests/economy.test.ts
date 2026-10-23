import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/schema';
import { cleanName, DEFAULT_LOOK, MIN_STARTING_CREDITS, newGame, startingCredits, type Captain, type GameState } from '../src/core/state';
import { Session } from '../src/core/session';
import { canRepaint, canUpgrade, repaint, shipStats, statsFor, upgrade } from '../src/systems/ship';
import { buy, cargoUsed, holdSize, maxBuyable, quote, sell } from '../src/systems/market';

const captain: Captain = { name: 'Rhea Vance', pronouns: 'she', origin: 'frontier-colonist', moment: 'silent-colony', motive: 'the-signal', look: DEFAULT_LOOK };
const at = (siteId: string, extra: Partial<GameState> = {}): GameState => {
  const spot = gameData.sites.get(siteId);
  if (!spot) throw new Error(`site ${siteId} missing`);
  return { ...newGame(1, 1, { captain, shipName: 'Lantern' }), systemId: spot.systemId, landedAt: siteId, mode: 'landed', ...extra };
};
const tradeSites = [...gameData.sites.values()].filter(({ site }) => site.services.includes('trade')).map(({ site }) => site.id);

describe('character creation', () => {
  it('sets starting credits from your story, never below the floor', () => {
    expect(startingCredits(null)).toBe(1000);
    const rich = startingCredits({ ...captain, origin: 'academy-legacy', moment: 'decorated-discharged' });
    const broke = startingCredits({ ...captain, origin: 'sol-undercity', moment: 'the-debt' });
    expect(rich).toBeGreaterThan(broke);
    expect(broke).toBeGreaterThanOrEqual(MIN_STARTING_CREDITS);
    // Every possible combination can afford at least a first small cargo.
    for (const o of gameData.creation.origins) {
      for (const m of gameData.creation.moments) {
        expect(startingCredits({ ...captain, origin: o.id, moment: m.id })).toBeGreaterThanOrEqual(MIN_STARTING_CREDITS);
      }
    }
  });

  it('cleans typed names and falls back when empty', () => {
    expect(cleanName('   Rhea    Vance  ', 'X')).toBe('Rhea Vance');
    expect(cleanName('   ', 'Wayfarer')).toBe('Wayfarer');
    expect(cleanName('a'.repeat(100), 'X')).toHaveLength(40);
  });

  it('a new career starts in Sol with your captain and named ship, saved immediately', () => {
    const saves: unknown[] = [];
    const s = Session.start(1, 1, { load: () => ({ status: 'empty' }), save: (d) => (saves.push(d), { ok: true }), backupCorrupt: () => ({ ok: true }) });
    s.startCareer(7, 2, { captain, shipName: '  Lantern ' });
    expect(s.state).toMatchObject({ captain, shipName: 'Lantern', systemId: 'sol', credits: startingCredits(captain) });
    expect(saves).toHaveLength(1);
  });
});

describe('your ship', () => {
  const def = gameData.ships.get('prototype');
  if (!def) throw new Error('prototype missing');

  it('stock stats are the flight values Tyler signed off', () => {
    const s = shipStats(def, {}, gameData.upgrades);
    expect(s).toMatchObject({ thrust: 440, maxSpeed: 340, turnRate: 5, drag: 0.9, cruiseMultiplier: 2.6, cargo: 20 });
  });

  it('every upgrade tier is strictly better than the one before, and never worse than stock', () => {
    for (const track of gameData.upgrades) {
      let prev = shipStats(def, {}, gameData.upgrades);
      for (let tier = 1; tier <= track.tiers.length; tier += 1) {
        const next = shipStats(def, { [track.id]: tier }, gameData.upgrades);
        const keys = ['thrust', 'maxSpeed', 'turnRate', 'cruiseMultiplier', 'cargo', 'hull', 'shields'] as const;
        const improved = keys.some((k) => next[k] > prev[k]);
        expect(improved, `${track.id} tier ${tier}`).toBe(true);
        for (const k of keys) expect(next[k], `${track.id} tier ${tier} ${k}`).toBeGreaterThanOrEqual(prev[k]);
        prev = next;
      }
    }
  });

  it('buys upgrades in order, only at a drydock, only with enough credits', () => {
    const rich = at('highport-docks', { credits: 50000 });
    expect(canUpgrade(rich, 'engines', gameData)).toMatchObject({ ok: true, tier: 1 });
    const one = upgrade(rich, 'engines', gameData);
    expect(one.upgrades['engines']).toBe(1);
    expect(one.credits).toBe(50000 - (gameData.upgrades[0]?.tiers[0]?.cost ?? 0));
    expect(canUpgrade(at('new-geneva', { credits: 50000 }), 'engines', gameData)).toEqual({ ok: false, reason: 'no-drydock' });
    expect(canUpgrade(at('highport-docks', { credits: 10 }), 'engines', gameData)).toEqual({ ok: false, reason: 'credits' });
    expect(canUpgrade(at('highport-docks', { credits: 99999, upgrades: { engines: 3 } }), 'engines', gameData)).toEqual({ ok: false, reason: 'maxed' });
  });

  it('cargo upgrades grow the hold', () => {
    expect(holdSize(at('new-geneva'), gameData)).toBe(20);
    expect(holdSize(at('new-geneva', { upgrades: { cargo: 3 } }), gameData)).toBe(65);
  });

  it('flight uses upgraded stats', () => {
    expect(statsFor(at('new-geneva', { upgrades: { engines: 1 } }), gameData).thrust).toBeCloseTo(440 * 1.1);
  });
});

describe('market', () => {
  it('quotes only where there is a market, the same every visit', () => {
    expect(quote('new-geneva', 'food', gameData)).not.toBeNull();
    expect(quote('tranquility', 'food', gameData)).toBeNull(); // no trade there
    expect(quote('new-geneva', 'food', gameData)).toEqual(quote('new-geneva', 'food', gameData));
  });

  it('places have character: Verdance sells food cheap, mining camps pay well for it', () => {
    const verdance = quote('verdance', 'food', gameData);
    const pits = quote('cinder-pits', 'food', gameData);
    expect(verdance?.level).toBe('cheap');
    expect(pits?.level).toBe('dear');
    expect((pits?.sell ?? 0)).toBeGreaterThan(verdance?.buy ?? Infinity);
  });

  it('never lets you profit by buying and selling in the same place', () => {
    for (const site of tradeSites) {
      for (const c of gameData.commodities.keys()) {
        const q = quote(site, c, gameData);
        if (q) expect(q.sell, `${site} ${c}`).toBeLessThan(q.buy);
      }
    }
  });

  it('respects credits and hold space, and round-trips cargo', () => {
    let s = at('new-geneva', { credits: 10000 });
    const r1 = buy(s, 'medicine', 5, gameData);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    s = r1.state;
    expect(cargoUsed(s)).toBe(5);
    expect(buy(s, 'food', 16, gameData)).toEqual({ ok: false, reason: 'hold-full' });
    expect(buy(at('new-geneva', { credits: 1 }), 'luxuries', 1, gameData)).toEqual({ ok: false, reason: 'credits' });
    expect(sell(s, 'ore', 1, gameData)).toEqual({ ok: false, reason: 'none-to-sell' });
    const r2 = sell(s, 'medicine', 5, gameData);
    expect(r2.ok && r2.state.cargo['medicine']).toBeUndefined();
    expect(maxBuyable(at('new-geneva', { credits: 1_000_000 }), 'food', gameData)).toBe(20);
  });

  /**
   * Balance: trading is side income, never the point of the game.
   * Target: with the stock hold, the single best buy-here-sell-there run in
   * the whole cluster earns between 300 and 1,600 credits. So it's worth
   * doing, but a first upgrade still takes a few runs, and missions and
   * discoveries (later milestones) are where the real money is.
   */
  it('best possible stock-hold trade run earns 300–1,600 credits', () => {
    let best = 0;
    for (const from of tradeSites) {
      for (const to of tradeSites) {
        if (from === to) continue;
        for (const c of gameData.commodities.keys()) {
          const a = quote(from, c, gameData);
          const b = quote(to, c, gameData);
          if (a && b) best = Math.max(best, (b.sell - a.buy) * 20);
        }
      }
    }
    expect(best).toBeGreaterThanOrEqual(300);
    expect(best).toBeLessThanOrEqual(1600);
  });
});

describe('appearance', () => {
  const paint = { hull: '#2b2f38', accent: '#ffd27a', pattern: 'chevron', glow: '#4fc3ff' };

  it('a new career keeps the paint and portrait you designed', () => {
    const s = newGame(1, 1, { captain: { ...captain, look: { ...captain.look, hair: 'curls' } }, shipName: 'Lantern', paint });
    expect(s.paint).toEqual(paint);
    expect(s.captain?.look.hair).toBe('curls');
  });

  it('repaints only at a drydock, for the flat fee, and only when something changed', () => {
    const dock = at('highport-docks', { credits: 5000 });
    expect(canRepaint(dock, paint, gameData)).toEqual({ ok: true, cost: gameData.appearance.repaintCost });
    expect(repaint(dock, paint, gameData).credits).toBe(5000 - gameData.appearance.repaintCost);
    expect(canRepaint(at('new-geneva', { credits: 5000 }), paint, gameData)).toEqual({ ok: false, reason: 'no-drydock' });
    expect(canRepaint(dock, dock.paint, gameData)).toEqual({ ok: false, reason: 'unchanged' });
    expect(canRepaint(at('highport-docks', { credits: 1 }), paint, gameData)).toEqual({ ok: false, reason: 'credits' });
    expect(canRepaint(dock, { ...paint, hull: '#123456' }, gameData)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('defaults are real options (a fresh ship and captain always render)', () => {
    const a = gameData.appearance;
    const p = newGame(1, 1).paint;
    expect(a.ship.hullColors).toContain(p.hull);
    expect(a.ship.accentColors).toContain(p.accent);
    expect(a.ship.glowColors).toContain(p.glow);
    expect(a.ship.patterns.map((x) => x.id)).toContain(p.pattern);
    expect(a.captain.faces.map((x) => x.id)).toContain(DEFAULT_LOOK.face);
    expect(a.captain.hairStyles.map((x) => x.id)).toContain(DEFAULT_LOOK.hair);
    expect(a.captain.outfits.map((x) => x.id)).toContain(DEFAULT_LOOK.outfit);
  });
});
