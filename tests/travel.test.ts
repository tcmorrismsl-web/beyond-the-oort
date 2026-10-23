import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/schema';
import { maxFuel, newGame, type GameState } from '../src/core/state';
import { Session, type SaveBackend } from '../src/core/session';
import { ARRIVAL_DISTANCE, canJump, depart, jump, land, landingTarget, LANDING_MARGIN } from '../src/systems/travel';
import type { SaveData } from '../src/core/save';

const fresh = (): GameState => newGame(1, 1);

describe('jumping', () => {
  it('allows a jump along a lane with fuel, and blocks every bad case', () => {
    const s = fresh();
    expect(canJump(s, 'alpha-centauri', gameData)).toEqual({ ok: true });
    const unlinked = [...gameData.systems.keys()].find((id) => id !== 'sol' && !gameData.systems.get('sol')?.links.includes(id)) ?? '';
    expect(canJump(s, unlinked, gameData)).toEqual({ ok: false, reason: 'not-linked' });
    expect(canJump(s, 'sol', gameData)).toEqual({ ok: false, reason: 'same-system' });
    expect(canJump(s, 'nowhere', gameData)).toEqual({ ok: false, reason: 'unknown-system' });
    expect(canJump({ ...s, fuel: 0 }, 'alpha-centauri', gameData)).toEqual({ ok: false, reason: 'no-fuel' });
    expect(canJump({ ...s, landedAt: 'new-geneva' }, 'alpha-centauri', gameData)).toEqual({ ok: false, reason: 'landed' });
  });

  it('uses one fuel, charts the system, and arrives at rest facing the star from the side you came from', () => {
    const s = jump(fresh(), 'alpha-centauri', gameData);
    expect(s.systemId).toBe('alpha-centauri');
    expect(s.fuel).toBe(maxFuel('shuttle') - 1);
    expect(s.visited).toEqual(['sol', 'alpha-centauri']);
    expect(Math.hypot(s.ship.x, s.ship.y)).toBeCloseTo(ARRIVAL_DISTANCE);
    expect(s.ship.vx).toBe(0);
    // Arrive on the side of the star that faces the system you came from.
    const sol = gameData.systems.get('sol');
    const ac = gameData.systems.get('alpha-centauri');
    if (!sol || !ac) throw new Error('systems missing');
    const dirX = sol.x - ac.x;
    const dirY = sol.y - ac.y;
    expect(s.ship.x * dirX + s.ship.y * dirY).toBeGreaterThan(0);
    const toStar = Math.atan2(-s.ship.y, -s.ship.x);
    expect(Math.cos(s.ship.angle - toStar)).toBeCloseTo(1);
  });

  it('never arrives inside a planet or the star in any system', () => {
    for (const sys of gameData.systems.values()) {
      for (const fromId of sys.links) {
        const from = gameData.systems.get(fromId);
        if (!from) continue;
        const s = jump({ ...fresh(), systemId: fromId, visited: [fromId] }, sys.id, gameData);
        for (const b of sys.bodies) {
          expect(Math.hypot(s.ship.x - b.x, s.ship.y - b.y), `${fromId} -> ${sys.id} vs ${b.id}`).toBeGreaterThan(b.radius + 60);
        }
        expect(Math.hypot(s.ship.x, s.ship.y)).toBeGreaterThan(sys.star.radius + 200);
      }
    }
  });

  it('can never strand you: every system sells fuel, so one jump always reaches a refuel', () => {
    for (const sys of gameData.systems.values()) {
      expect(sys.bodies.some((b) => b.sites.some((st) => st.services.includes('refuel'))), sys.id).toBe(true);
    }
  });
});

describe('landing', () => {
  it('offers a landing only when close to a landable body', () => {
    const s = fresh();
    const earth = gameData.bodies.get('earth')?.body;
    if (!earth) throw new Error('earth missing');
    expect(landingTarget({ ...s, ship: { ...s.ship, x: earth.x - earth.radius - LANDING_MARGIN + 1, y: earth.y } }, gameData)?.id).toBe('earth');
    expect(landingTarget({ ...s, ship: { ...s.ship, x: earth.x - earth.radius - LANDING_MARGIN - 5, y: earth.y } }, gameData)).toBeNull();
    const jupiter = gameData.bodies.get('jupiter')?.body;
    if (!jupiter) throw new Error('jupiter missing');
    expect(landingTarget({ ...s, ship: { ...s.ship, x: jupiter.x, y: jupiter.y } }, gameData)).toBeNull();
  });

  it('refuels to full only where fuel is sold; refuses sites in other systems or that do not exist', () => {
    const s = land({ ...fresh(), fuel: 0 }, 'new-geneva', gameData, 4);
    expect(s).toMatchObject({ landedAt: 'new-geneva', fuel: 4 });
    // Valles Commons (Mars) has no fuel service.
    expect(land({ ...fresh(), fuel: 1 }, 'valles-commons', gameData, 4).fuel).toBe(1);
    expect(() => land(fresh(), 'terminator-city', gameData, 4)).toThrow();
    expect(() => land(fresh(), 'jupiter', gameData, 4)).toThrow();
  });

  it('departs just outside the body, facing away from the star, and is not immediately re-landed by mistake', () => {
    const landed = land(fresh(), 'new-geneva', gameData, 4);
    const s = depart(landed, gameData);
    const earth = gameData.bodies.get('earth')?.body;
    if (!earth) throw new Error('earth missing');
    expect(s.landedAt).toBeNull();
    expect(Math.hypot(s.ship.x - earth.x, s.ship.y - earth.y)).toBeGreaterThan(earth.radius);
    expect(Math.hypot(s.ship.x, s.ship.y)).toBeGreaterThan(Math.hypot(earth.x, earth.y));
  });
});

describe('session travel', () => {
  function backend(): SaveBackend & { saves: SaveData[] } {
    const b = {
      saves: [] as SaveData[],
      load: () => ({ status: 'empty' as const }),
      save: (d: SaveData) => {
        b.saves.push(d);
        return { ok: true as const };
      },
      backupCorrupt: () => ({ ok: true as const }),
    };
    return b;
  }

  it('lands, departs and jumps with saves and events at each step', () => {
    const b = backend();
    const s = Session.start(1, 1, b);
    const events: string[] = [];
    s.bus.on('landed', (p) => events.push(`landed:${p.siteId}`));
    s.bus.on('departed', (p) => events.push(`departed:${p.siteId}`));
    s.bus.on('jumped', (p) => events.push(`jumped:${p.from}>${p.to}`));

    expect(s.landOn('new-geneva', 2)).toBe(true);
    expect(s.state.mode).toBe('landed');
    expect(s.jumpTo('alpha-centauri', 3)).toEqual({ ok: false, reason: 'landed' });
    expect(s.departPort(4)).toBe(true);
    expect(s.state.mode).toBe('flight');
    expect(s.jumpTo('alpha-centauri', 5)).toEqual({ ok: true });

    expect(events).toEqual(['landed:new-geneva', 'departed:new-geneva', 'jumped:sol>alpha-centauri']);
    expect(b.saves.map((d) => [d.systemId, d.landedAt])).toEqual([
      ['sol', 'new-geneva'],
      ['sol', null],
      ['alpha-centauri', null],
    ]);
  });
});

describe('moving between sites on one planet', () => {
  it('hops between sites on the same body, but not to another body', () => {
    const s = Session.start(1, 1, {
      load: () => ({ status: 'empty' as const }),
      save: () => ({ ok: true as const }),
      backupCorrupt: () => ({ ok: true as const }),
    });
    expect(s.landOn('new-geneva', 1)).toBe(true);
    expect(s.moveToSite('lagos-skyport', 2)).toBe(true);
    expect(s.state.landedAt).toBe('lagos-skyport');
    expect(s.moveToSite('olympus-yards', 3)).toBe(false); // Mars, not Earth
    expect(s.moveToSite('lagos-skyport', 4)).toBe(false); // already here
    expect(s.state.mode).toBe('landed');
  });
});
