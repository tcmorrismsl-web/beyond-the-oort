import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/events';
import { canTransition, transition, type GameMode } from '../src/core/flow';
import { SaveSchema, type LoadResult, type SaveData } from '../src/core/save';
import { Session, type SaveBackend } from '../src/core/session';
import { fromSave, newGame, repairAgainstContent, STARTING_SHIP, STARTING_SYSTEM, toSave } from '../src/core/state';
import { gameData } from '../src/data/schema';
import type { StorageResult } from '../src/core/storage';

function fakeBackend(initial: LoadResult): SaveBackend & { saved: SaveData[]; backups: number[]; failNext: boolean } {
  const b = {
    saved: [] as SaveData[],
    backups: [] as number[],
    failNext: false,
    load: () => initial,
    save: (data: SaveData): StorageResult => {
      if (b.failNext) return { ok: false, reason: 'quota exceeded' };
      b.saved.push(data);
      return { ok: true };
    },
    backupCorrupt: (now: number): StorageResult => {
      b.backups.push(now);
      return { ok: true };
    },
  };
  return b;
}

describe('event bus', () => {
  it('delivers typed payloads and unsubscribes cleanly', () => {
    const bus = new EventBus();
    const got: number[] = [];
    const off = bus.on('saved', (p) => got.push(p.at));
    bus.emit('saved', { at: 1 });
    off();
    bus.emit('saved', { at: 2 });
    expect(got).toEqual([1]);
    expect(bus.listenerCount('saved')).toBe(0);
  });

  it('keeps delivering when one handler throws', () => {
    const bus = new EventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const got: number[] = [];
    bus.on('saved', () => {
      throw new Error('boom');
    });
    bus.on('saved', (p) => got.push(p.at));
    bus.emit('saved', { at: 7 });
    expect(got).toEqual([7]);
    spy.mockRestore();
  });

  it('survives a handler that unsubscribes itself mid-emit', () => {
    const bus = new EventBus();
    const got: string[] = [];
    const off = bus.on('saved', () => {
      got.push('a');
      off();
    });
    bus.on('saved', () => got.push('b'));
    bus.emit('saved', { at: 1 });
    bus.emit('saved', { at: 2 });
    expect(got).toEqual(['a', 'b', 'b']);
  });
});

describe('game flow', () => {
  const modes: GameMode[] = ['flight', 'landed', 'onFoot'];

  it('allows every planned move between modes', () => {
    expect(canTransition('flight', 'landed')).toBe(true);
    expect(canTransition('landed', 'flight')).toBe(true);
    expect(canTransition('landed', 'onFoot')).toBe(true);
    expect(canTransition('onFoot', 'landed')).toBe(true);
    expect(canTransition('flight', 'onFoot')).toBe(true); // boarding
    expect(canTransition('onFoot', 'flight')).toBe(true); // back to the helm
  });

  it('rejects staying in the same mode', () => {
    for (const m of modes) expect(transition(m, m).ok).toBe(false);
  });
});

describe('game state', () => {
  it('starts with a ship and system that exist in the content data', () => {
    const s = newGame(42, 1000);
    expect(gameData.ships.has(STARTING_SHIP)).toBe(true);
    expect(gameData.systems.has(STARTING_SYSTEM)).toBe(true);
    expect(s.mode).toBe('flight');
  });

  it('produces a save that passes validation and round-trips', () => {
    const s = newGame(42, 1000);
    s.ship.x = 123.5;
    s.ship.y = -40;
    s.ship.angle = 2;
    s.credits = 777;
    const save = toSave(s, 2000);
    expect(SaveSchema.safeParse(save).success).toBe(true);
    const back = fromSave(save);
    expect(back.credits).toBe(777);
    expect(back.ship).toMatchObject({ x: 123.5, y: -40, angle: 2, vx: 0, vy: 0 });
  });
});

describe('session', () => {
  const saved: SaveData = toSave(newGame(9, 10), 20);

  it('resumes an existing save', () => {
    const s = Session.start(1, 100, fakeBackend({ status: 'ok', data: { ...saved, credits: 55 } }));
    expect(s.started).toBe('resumed');
    expect(s.state.credits).toBe(55);
  });

  it('starts a new game when there is no save', () => {
    const s = Session.start(1, 100, fakeBackend({ status: 'empty' }));
    expect(s.started).toBe('new');
    expect(s.loadProblem).toBeNull();
  });

  it('backs up a corrupt save before starting fresh, and reports it', () => {
    const backend = fakeBackend({ status: 'corrupt', reason: 'bad data' });
    const s = Session.start(1, 100, backend);
    expect(s.started).toBe('recovered');
    expect(s.loadProblem).toContain('bad data');
    expect(backend.backups).toEqual([100]);
  });

  it('announces saves and save failures', () => {
    const backend = fakeBackend({ status: 'empty' });
    const s = Session.start(1, 100, backend);
    const events: string[] = [];
    s.bus.on('saved', () => events.push('saved'));
    s.bus.on('saveFailed', (p) => events.push(`failed:${p.reason}`));
    s.save(200);
    backend.failNext = true;
    s.save(300);
    expect(events).toEqual(['saved', 'failed:quota exceeded']);
    expect(backend.saved).toHaveLength(1);
  });

  it('refuses to write invalid state (NaN position) and reports it instead of throwing', () => {
    const backend = fakeBackend({ status: 'empty' });
    backend.save = (data) => {
      SaveSchema.parse(data); // same validation the real save path runs
      return { ok: true };
    };
    const s = Session.start(1, 100, backend);
    s.state.ship.x = Number.NaN;
    const failures: string[] = [];
    s.bus.on('saveFailed', (p) => failures.push(p.reason));
    expect(s.save(200).ok).toBe(false);
    expect(failures).toHaveLength(1);
  });

  it('changes mode only through legal transitions and announces them', () => {
    const s = Session.start(1, 100, fakeBackend({ status: 'empty' }));
    const seen: string[] = [];
    s.bus.on('modeChanged', (p) => seen.push(`${p.from}->${p.to}`));
    expect(s.setMode('landed').ok).toBe(true);
    expect(s.setMode('landed').ok).toBe(false);
    expect(s.state.mode).toBe('landed');
    expect(seen).toEqual(['flight->landed']);
  });
});

describe('loading against changed content', () => {
  it('repairs references to content that no longer exists instead of crashing', () => {
    const s = newGame(1, 1);
    s.systemId = 'gone-system';
    s.landedAt = 'gone-station';
    s.ship.defId = 'gone-ship';
    s.upgrades = { engines: 99 };
    s.visited = ['sol', 'gone-system'];
    const fixed = repairAgainstContent(s);
    expect(fixed).toEqual([`unknown ship "gone-ship"`, `unknown system "gone-system"`, `upgrade "engines" tier 99 no longer exists`]);
    expect(s).toMatchObject({ systemId: STARTING_SYSTEM, landedAt: null, mode: 'flight', visited: ['sol'] });
    expect(s.ship.defId).toBe(STARTING_SHIP);
    expect(s.upgrades['engines']).toBe(gameData.upgrades.find((t) => t.id === 'engines')?.tiers.length);
  });

  it('resumes landed when the save says so', () => {
    const s = newGame(1, 1);
    s.landedAt = 'new-geneva';
    const back = fromSave(toSave(s, 2));
    expect(repairAgainstContent(back)).toEqual([]);
    expect(back.mode).toBe('landed');
  });

  it('drops a landing spot that belongs to a different system', () => {
    const s = newGame(1, 1);
    s.landedAt = 'terminator-city'; // Alpha Centauri, not Sol
    repairAgainstContent(s);
    expect(s.landedAt).toBeNull();
  });
});
