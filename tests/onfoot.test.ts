import { describe, expect, it } from 'vitest';
import { buildGameData, gameData, walkableTile } from '../src/data/schema';
import { DEFAULT_LOOK, newGame } from '../src/core/state';
import { autoSpotAt, blocked, REACH, stepWalker, withinReach, type Walker } from '../src/systems/onfoot';
import { consumeSteps, STEP } from '../src/systems/flight';

const room = ['#####', '#...#', '#...#', '#####'];
const state = newGame(1, 1, { captain: { name: 'R', pronouns: 'she', origin: 'frontier-colonist', moment: 'silent-colony', motive: 'the-signal', look: DEFAULT_LOOK }, shipName: 'L' });

describe('walking', () => {
  it('walks freely on floor and stops at walls, sliding along them', () => {
    let w: Walker = { x: 2.5, y: 1.5, facing: 0 };
    for (let i = 0; i < 120; i += 1) w = stepWalker(w, 1, 0, STEP, room); // two seconds east
    expect(w.x).toBeLessThan(4 - 0.27);
    expect(w.x).toBeGreaterThan(3.5);
    expect(blocked(room, w.x, w.y)).toBe(false);
    // Diagonal into the corner: slides along the wall instead of sticking.
    const start = { x: 2, y: 2, facing: 0 };
    let d = start;
    for (let i = 0; i < 120; i += 1) d = stepWalker(d, 1, -Math.PI / 4, STEP, room);
    expect(d.x).toBeGreaterThan(start.x);
    expect(blocked(room, d.x, d.y)).toBe(false);
  });

  it('never tunnels through a wall, even after a long frame', () => {
    const corridor = ['#######', '#..#..#', '#######'];
    let w: Walker = { x: 1.5, y: 1.5, facing: 0 };
    const { steps } = consumeSteps(0, 1); // a one-second hitch
    for (let i = 0; i < steps * 4; i += 1) w = stepWalker(w, 1, 0, STEP, corridor);
    expect(w.x).toBeLessThan(3);
  });

  it('standing still does nothing', () => {
    const w = { x: 2, y: 2, facing: 1 };
    expect(stepWalker(w, 0, 0, STEP, room)).toBe(w);
    expect(stepWalker(w, 1, null, STEP, room)).toBe(w);
  });
});

describe('walkable places (content)', () => {
  /** Tiles you can actually walk to from the spawn point. */
  function reachableTiles(map: readonly string[], sx: number, sy: number): Set<string> {
    const seen = new Set<string>();
    const queue: [number, number][] = [[Math.floor(sx), Math.floor(sy)]];
    while (queue.length > 0) {
      const [x, y] = queue.shift() ?? [0, 0];
      const k = `${x},${y}`;
      if (seen.has(k) || !walkableTile(map, x + 0.5, y + 0.5)) continue;
      seen.add(k);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
  }

  for (const inside of gameData.interiors.values()) {
    it(`${inside.name}: every spot, person and the exit can be reached on foot from the spawn`, () => {
      const tiles = [...reachableTiles(inside.map, inside.spawn.x, inside.spawn.y)].map((k) => k.split(',').map(Number) as [number, number]);
      const canReach = (x: number, y: number): boolean => tiles.some(([tx, ty]) => Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= REACH);
      for (const s of inside.spots) expect(canReach(s.x, s.y), `spot ${s.id}`).toBe(true);
      for (const p of inside.people) expect(canReach(p.x, p.y), `person ${p.character}`).toBe(true);
      expect(canReach(inside.exit.x, inside.exit.y), 'exit').toBe(true);
    });
  }

  it('the Ninefold: you can always leave, and stepping aboard plays once', () => {
    const nf = gameData.interiors.get('ninefold');
    if (!nf) throw new Error('ninefold missing');
    const atDoor: Walker = { x: nf.spawn.x, y: nf.spawn.y, facing: 0 };
    const s = { ...state, flags: ['ilse-hired'] };
    expect(autoSpotAt(nf, atDoor, s, gameData)).toBe('airlock');
    expect(autoSpotAt(nf, atDoor, { ...s, flags: [...s.flags, 'nf-boarded'] }, gameData)).toBeNull();
    expect(withinReach(nf, atDoor, s, gameData).map((r) => r.kind)).toContain('exit');
    const bridge = nf.spots.find((x) => x.id === 'bridge');
    const there = withinReach(nf, { x: bridge?.x ?? 0, y: (bridge?.y ?? 0) + 0.3, facing: 0 }, s, gameData);
    expect(there[0]?.label).toBe('Flight recorder');
  });

  it('rejects broken maps: ragged rows, unknown tiles, spawn in a wall, spots with nothing to say', () => {
    const ship = { id: 'a', name: 'A', hull: 1, shields: 0, thrust: 1, maxSpeed: 1, turnRate: 1, drag: 0, cargo: 0 };
    const base = { id: 'x', name: 'X', theme: 'derelict', map: ['####', '#..#', '####'], spawn: { x: 1.5, y: 1.5 }, exit: { x: 1.5, y: 1.5, label: 'Out' }, spots: [] };
    const build = (inside: object) => buildGameData({ ships: [ship], systems: [], interiors: [{ ...base, ...inside }] });
    expect(() => build({})).not.toThrow();
    expect(() => build({ map: ['####', '#..', '####'] })).toThrow(/wide/);
    expect(() => build({ map: ['####', '#.?#', '####'] })).toThrow(/unknown tile/);
    expect(() => build({ spawn: { x: 0.5, y: 0.5 } })).toThrow(/spawn/);
    expect(() => build({ spots: [{ id: 's', x: 2, y: 1.5, label: 'S' }] })).toThrow(/no conversation/);
  });
});
