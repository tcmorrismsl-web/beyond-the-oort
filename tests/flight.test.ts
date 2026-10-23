import { describe, expect, it } from 'vitest';
import { angleDelta, consumeSteps, STEP, stepShip, type FlightStats, type ShipKinematics } from '../src/systems/flight';

const stats: FlightStats = { thrust: 300, maxSpeed: 400, turnRate: 3, drag: 0.5 };
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
