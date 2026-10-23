import { describe, expect, it } from 'vitest';
import { buildGameData, gameData } from '../src/data/schema';
import { readStick } from '../src/ui/joystick';
import { Rng } from '../src/core/rng';

const ship = { id: 'a', name: 'A', hull: 1, shields: 0, thrust: 1, maxSpeed: 1, turnRate: 1, drag: 0, cargo: 0 };
const body = (id: string, x: number, sites: unknown[] = []) => ({ id, name: id, kind: 'planet', x, y: 0, radius: 20, color: '#ffffff', sites });
const sys = (id: string, links: string[] = [], bodies: unknown[] = []) => ({ id, name: id, x: 0, y: 0, links, bodies });
const site = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, kind: 'city', description: 'd', services: ['trade'], ...extra });

describe('game data', () => {
  it('ships with valid, cross-referenced content', () => {
    expect(gameData.ships.size).toBeGreaterThan(0);
    expect(gameData.systems.size).toBeGreaterThan(0);
    expect(gameData.upgrades.length).toBeGreaterThan(0);
    expect(gameData.commodities.size).toBeGreaterThan(0);
  });

  it('catches broken references', () => {
    expect(() => buildGameData({ ships: [ship], systems: [sys('x', ['missing'])] })).toThrow(/missing system/);
    expect(() => buildGameData({ ships: [ship], systems: [sys('x', ['y']), sys('y')] })).toThrow(/one-way/);
    expect(() => buildGameData({ ships: [ship, ship], systems: [] })).toThrow(/duplicate ship/);
  });

  it('catches bad content: bodies inside the star, duplicate ids, notes for missing services, unknown market goods', () => {
    expect(() => buildGameData({ ships: [ship], systems: [sys('x', [], [body('p', 50)])] })).toThrow(/too close to the star/);
    expect(() => buildGameData({ ships: [ship], systems: [sys('x', [], [body('p', 900)]), sys('y', [], [body('p', 900)])] })).toThrow(/duplicate body/);
    const noted = site('s', { notes: { bar: 'no bar here' } });
    expect(() => buildGameData({ ships: [ship], systems: [sys('x', [], [body('p', 900, [noted])])] })).toThrow(/note for "bar"/);
    const market = site('m', { market: { cheap: ['unobtainium'], dear: [] } });
    expect(() => buildGameData({ ships: [ship], systems: [sys('x', [], [body('p', 900, [market])])] })).toThrow(/missing commodity/);
  });

  it('catches upgrade tiers that do not cost more than the tier before', () => {
    const track = { id: 't', name: 'T', description: 'd', tiers: [{ name: 'a', cost: 500, effect: {} }, { name: 'b', cost: 400, effect: {} }] };
    expect(() => buildGameData({ ships: [ship], systems: [], upgrades: [track] })).toThrow(/must cost more/);
  });
});

describe('joystick', () => {
  it('has a dead zone and full throttle at the rim', () => {
    expect(readStick(0, 0, 2, 0, 60).angle).toBeNull();
    const full = readStick(0, 0, 0, 200, 60);
    expect(full.throttle).toBe(1);
    expect(full.angle).toBeCloseTo(Math.PI / 2);
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    expect([a.next(), a.int(1, 6), a.range(0, 1)]).toEqual([b.next(), b.int(1, 6), b.range(0, 1)]);
  });
});

describe('star cluster', () => {
  it('every system is reachable from Sol', () => {
    const seen = new Set(['sol']);
    const queue = ['sol'];
    while (queue.length > 0) {
      const id = queue.shift() ?? '';
      for (const link of gameData.systems.get(id)?.links ?? []) {
        if (!seen.has(link)) {
          seen.add(link);
          queue.push(link);
        }
      }
    }
    expect([...gameData.systems.keys()].filter((id) => !seen.has(id))).toEqual([]);
  });

  it('every system has somewhere to land (a port or a waystation)', () => {
    for (const s of gameData.systems.values()) {
      expect(s.bodies.some((b) => b.sites.length > 0), s.id).toBe(true);
    }
  });

  it('uses real star names (the real-star cluster stays real)', () => {
    for (const name of ['Sol', 'Alpha Centauri', "Barnard's Star", 'Wolf 359', 'Sirius', 'Tau Ceti', 'Epsilon Eridani', 'Procyon', 'Vega']) {
      expect([...gameData.systems.values()].some((s) => s.name === name), name).toBe(true);
    }
  });

  it('gives sites their own character: not every port offers the same services', () => {
    const menus = new Set([...gameData.sites.values()].map(({ site: st }) => [...st.services].sort().join(',')));
    expect(menus.size).toBeGreaterThan(8);
  });

  it('lets some planets offer more than one landing site', () => {
    const multi = [...gameData.bodies.values()].filter(({ body: b }) => b.sites.length > 1);
    expect(multi.length).toBeGreaterThan(2);
  });

  it('has drydocks to upgrade your ship within a couple of jumps of the start', () => {
    const drydocks = [...gameData.sites.values()].filter(({ site: st }) => st.services.includes('drydock'));
    expect(drydocks.some((d) => d.systemId === 'sol')).toBe(true);
    expect(drydocks.length).toBeGreaterThanOrEqual(3);
  });
});

describe('character creation content', () => {
  it('offers several real choices at every step, plus ship name ideas', () => {
    const c = gameData.creation;
    expect(c.origins.length).toBeGreaterThanOrEqual(3);
    expect(c.moments.length).toBeGreaterThanOrEqual(3);
    expect(c.motives.length).toBeGreaterThanOrEqual(3);
    expect(c.ship.nameSuggestions.length).toBeGreaterThanOrEqual(4);
    // Every defining moment explains how the ship came to you.
    for (const m of c.moments) expect(m.shipStory, m.id).toBeTruthy();
  });
});
