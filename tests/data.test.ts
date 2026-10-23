import { describe, expect, it } from 'vitest';
import { buildGameData, gameData } from '../src/data/schema';
import { readStick } from '../src/ui/joystick';
import { Rng } from '../src/core/rng';

describe('game data', () => {
  it('ships with valid, cross-referenced content', () => {
    expect(gameData.ships.size).toBeGreaterThan(0);
    expect(gameData.systems.size).toBeGreaterThan(0);
  });

  it('catches broken references', () => {
    const ship = { id: 'a', name: 'A', hull: 1, shields: 0, thrust: 1, maxSpeed: 1, turnRate: 1, drag: 0, cargo: 0, price: 0 };
    const depot = (id: string) => ({ id: `${id}-depot`, name: 'D', kind: 'station', x: 900, y: 0, radius: 20, color: '#ffffff', sites: [{ id: `${id}-dock`, name: 'Dock', kind: 'depot', description: 'd', services: ['refuel'] }] });
    const sys = (id: string, links: string[], shipyard: string[]) => ({ id, name: id, x: 0, y: 0, links, shipyard, bodies: [depot(id)] });
    expect(() => buildGameData([ship], [sys('x', ['missing'], [])])).toThrow(/missing system/);
    expect(() => buildGameData([ship], [sys('x', ['y'], []), sys('y', [], [])])).toThrow(/one-way/);
    expect(() => buildGameData([ship], [sys('x', [], ['ghost'])])).toThrow(/missing ship/);
    expect(() => buildGameData([ship, ship], [])).toThrow(/duplicate ship/);
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

  it('every system has somewhere to refuel, and depots refuel for free', () => {
    for (const sys of gameData.systems.values()) {
      const fuel = sys.bodies.flatMap((b) => b.sites).filter((st) => st.services.includes('refuel'));
      expect(fuel.length, sys.id).toBeGreaterThan(0);
    }
    for (const { site } of gameData.sites.values()) {
      if (site.kind === 'depot') expect(site.services, site.id).toContain('refuel');
    }
  });

  it('uses real star names (the real-star cluster stays real)', () => {
    for (const name of ['Sol', 'Alpha Centauri', "Barnard's Star", 'Wolf 359', 'Sirius', 'Tau Ceti', 'Epsilon Eridani', 'Procyon', 'Vega']) {
      expect([...gameData.systems.values()].some((s) => s.name === name), name).toBe(true);
    }
  });

  it('gives sites their own character: not every port offers the same services', () => {
    const menus = new Set([...gameData.sites.values()].map(({ site }) => [...site.services].sort().join(',')));
    expect(menus.size).toBeGreaterThan(8);
  });

  it('lets some planets offer more than one landing site', () => {
    const multi = [...gameData.bodies.values()].filter(({ body }) => body.sites.length > 1);
    expect(multi.length).toBeGreaterThan(2);
  });

  it('catches bad content: bodies inside the star, duplicate ids, no fuel, notes for missing services', () => {
    const ship = { id: 'a', name: 'A', hull: 1, shields: 0, thrust: 1, maxSpeed: 1, turnRate: 1, drag: 0, cargo: 0, price: 0 };
    const fuel = { id: 'fuel', name: 'Fuel', kind: 'depot', description: 'd', services: ['refuel'] };
    const body = (id: string, x: number, sites: unknown[] = []) => ({ id, name: id, kind: 'planet', x, y: 0, radius: 20, color: '#ffffff', sites });
    const fuelBody = (id: string) => ({ ...body(id, 900), sites: [{ ...fuel, id: `${id}-site` }] });
    const sys = (id: string, bodies: unknown[]) => ({ id, name: id, x: 0, y: 0, links: [], shipyard: [], bodies });
    expect(() => buildGameData([ship], [sys('x', [body('p', 50), fuelBody('f')])])).toThrow(/too close to the star/);
    expect(() => buildGameData([ship], [sys('x', [fuelBody('p')]), sys('y', [fuelBody('p')])])).toThrow(/duplicate body/);
    expect(() => buildGameData([ship], [sys('x', [body('p', 900)])])).toThrow(/nowhere to refuel/);
    const noted = { ...fuel, notes: { bar: 'no bar here' } };
    expect(() => buildGameData([ship], [sys('x', [body('p', 900, [noted])])])).toThrow(/note for "bar"/);
  });
});
