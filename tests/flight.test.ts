import { describe, expect, it } from 'vitest';
import { gameData, type ShipDef } from '../src/data/schema';
import { angleDelta, consumeSteps, CRUISE_HOLD, CRUISE_IDLE, CRUISE_THROTTLE, STEP, stepShip, updateCruise, type CruiseState, type FlightStats, type ShipKinematics } from '../src/systems/flight';

function shipDef(id: string): ShipDef {
  const def = gameData.ships.get(id);
  if (!def) throw new Error(`ship "${id}" missing from data`);
  return def;
}

const stats: FlightStats = { thrust: 300, maxSpeed: 400, turnRate: 3, drag: 0.5, cruiseMultiplier: 2 };
const still: ShipKinematics = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };

function simulate(seconds: number, hz: number, s0: ShipKinematics = still): ShipKinematics {
  let s = s0;
  let acc = 0;
  const frames = Math.round(seconds * hz);
  for (let f = 0; f < frames; f += 1) {
    const r = consumeSteps(acc, 1 / hz);
    acc = r.remainder;
    for (let i = 0; i < r.steps; i += 1) s = stepShip(s, stats, { throttle: 1, targetAngle: Math.PI / 2 }, STEP);
  }
  return s;
}

describe('flight', () => {
  it('thrusts along its facing', () => {
    const s = stepShip(still, stats, { throttle: 1, targetAngle: null }, STEP);
    expect(s.vx).toBeGreaterThan(0);
    expect(s.vy).toBeCloseTo(0);
  });

  it('never exceeds max speed', () => {
    const s = simulate(30, 60);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(stats.maxSpeed + 1e-9);
  });

  it('turns the short way and does not overshoot', () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    const s = stepShip({ ...still, angle: 0 }, stats, { throttle: 0, targetAngle: 0.01 }, STEP);
    expect(s.angle).toBeCloseTo(0.01);
  });

  it('behaves the same at 60Hz, 120Hz and 30Hz displays', () => {
    const a = simulate(3, 60);
    const b = simulate(3, 120);
    const c = simulate(3, 30);
    expect(b.x).toBeCloseTo(a.x, 0);
    expect(b.y).toBeCloseTo(a.y, 0);
    expect(c.y).toBeCloseTo(a.y, 0);
  });

  it('caps a long stall instead of fast-forwarding', () => {
    expect(consumeSteps(0, 10).steps).toBe(15);
  });

  it('ignores bad input without producing NaN', () => {
    const s = stepShip(still, stats, { throttle: Number.NaN, targetAngle: Number.POSITIVE_INFINITY }, STEP);
    expect(Object.values(s).every(Number.isFinite)).toBe(true);
  });
});

// Feel targets from the first iPhone playtest (handling rated 3/5, "a bit
// under-responsive"). These keep the starter ship snappy if numbers drift.
describe('starter ship handling targets', () => {
  const stock = shipDef('prototype');

  it('reaches 80% of top speed from rest within 1.2 s at full throttle', () => {
    let s: ShipKinematics = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
    let t = 0;
    while (Math.hypot(s.vx, s.vy) < stock.maxSpeed * 0.8 && t < 5) {
      s = stepShip(s, stock, { throttle: 1, targetAngle: 0 }, STEP);
      t += STEP;
    }
    expect(t).toBeLessThanOrEqual(1.2);
  });

  it('turns around (180°) within 0.7 s', () => {
    let s: ShipKinematics = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
    let t = 0;
    while (Math.abs(angleDelta(s.angle, Math.PI)) > 1e-6 && t < 5) {
      s = stepShip(s, stock, { throttle: 0, targetAngle: Math.PI }, STEP);
      t += STEP;
    }
    expect(t).toBeLessThanOrEqual(0.7);
  });

  it('coasts nearly to a stop within 4 s of letting go', () => {
    let s: ShipKinematics = { x: 0, y: 0, vx: stock.maxSpeed, vy: 0, angle: 0 };
    for (let t = 0; t < 4; t += STEP) s = stepShip(s, stock, { throttle: 0, targetAngle: null }, STEP);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(stock.maxSpeed * 0.05);
  });
});

// Playtest 2: "slow when trying to get somewhere fast". Cruise targets:
describe('cruise', () => {
  const stock = shipDef('prototype');

  function fly(seconds: number, throttle: number, s0: ShipKinematics = still, c0: CruiseState = CRUISE_IDLE) {
    let s = s0;
    let c = c0;
    for (let t = 0; t < seconds - 1e-9; t += STEP) {
      c = updateCruise(c, throttle, STEP);
      s = stepShip(s, stock, { throttle, targetAngle: 0, cruise: c.level }, STEP);
    }
    return { s, c };
  }

  it('crosses 3,000 px in under 6 s when the stick is held at the edge', () => {
    let s: ShipKinematics = still;
    let c = CRUISE_IDLE;
    let t = 0;
    while (s.x < 3000 && t < 20) {
      c = updateCruise(c, 1, STEP);
      s = stepShip(s, stock, { throttle: 1, targetAngle: 0, cruise: c.level }, STEP);
      t += STEP;
    }
    expect(t).toBeLessThan(6);
  });

  it('reaches cruise speed well above normal top speed', () => {
    const { s } = fly(5, 1);
    expect(Math.hypot(s.vx, s.vy)).toBeGreaterThan(stock.maxSpeed * 2);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(stock.maxSpeed * stock.cruiseMultiplier + 1e-6);
  });

  it('does not engage from a quick flick to the edge', () => {
    let c = CRUISE_IDLE;
    for (let t = 0; t < CRUISE_HOLD * 0.8; t += STEP) c = updateCruise(c, 1, STEP);
    c = updateCruise(c, 0.5, STEP);
    for (let t = 0; t < CRUISE_HOLD * 0.8; t += STEP) c = updateCruise(c, 1, STEP);
    expect(c.level).toBe(0);
  });

  it('never engages below the edge threshold', () => {
    const { s, c } = fly(5, CRUISE_THROTTLE - 0.05);
    expect(c.level).toBe(0);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(stock.maxSpeed + 1e-6);
  });

  it('eases back to normal top speed within 2 s of leaving cruise, without a sudden stop', () => {
    const cruising = fly(5, 1);
    let s = cruising.s;
    let c = cruising.c;
    let prev = Math.hypot(s.vx, s.vy);
    let biggestDrop = 0;
    for (let t = 0; t < 2; t += STEP) {
      c = updateCruise(c, 0.6, STEP);
      s = stepShip(s, stock, { throttle: 0.6, targetAngle: 0, cruise: c.level }, STEP);
      const v = Math.hypot(s.vx, s.vy);
      biggestDrop = Math.max(biggestDrop, prev - v);
      prev = v;
    }
    expect(prev).toBeLessThanOrEqual(stock.maxSpeed * 1.02);
    // No single frame loses more than 4% of top speed (no invisible wall).
    expect(biggestDrop).toBeLessThan(stock.maxSpeed * stock.cruiseMultiplier * 0.04);
  });
});
