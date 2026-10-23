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
    const sys = (id: string, links: string[], shipyard: string[]) => ({ id, name: id, x: 0, y: 0, links, shipyard });
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
