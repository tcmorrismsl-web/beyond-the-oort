import { describe, expect, it } from 'vitest';
import { deserialize, exportSave, importSave, SAVE_VERSION, serialize, type SaveData } from '../src/core/save';

const sample: SaveData = {
  version: SAVE_VERSION,
  createdAt: 1,
  updatedAt: 2,
  rngSeed: 42,
  credits: 1500,
  systemId: 'sol',
  ship: { defId: 'shuttle', x: 10, y: -5, angle: 1.2 },
  visited: ['sol'],
  landedAt: null,
  captain: { name: 'Ada Kell', pronouns: 'they', origin: 'freighter-born', moment: 'the-debt', motive: 'running' },
  shipName: 'Kestrel',
  upgrades: { engines: 2 },
  cargo: { ore: 5 },
  locker: {},
  flags: ['met-mara'],
};

describe('save system', () => {
  // One fixture per released save version. Never edit or delete these: they
  // prove a player's old save still loads after every update.
  it('loads every historical save version', () => {
    const fixtures = import.meta.glob<{ default: unknown }>('./fixtures/save-v*.json', { eager: true });
    for (let v = 1; v <= SAVE_VERSION; v += 1) {
      const fixture = fixtures[`./fixtures/save-v${v}.json`];
      expect(fixture, `tests/fixtures/save-v${v}.json is missing`).toBeDefined();
      expect(deserialize(JSON.stringify(fixture?.default)).status, `save-v${v}.json`).toBe('ok');
    }
  });

  it('upgrades a v1 save all the way: keeps place, credits and ship position', () => {
    const v1 = { version: 1, createdAt: 1, updatedAt: 2, rngSeed: 5, credits: 2500, systemId: 'sol', ship: { defId: 'shuttle', x: 120.5, y: -48, angle: 1.57 } };
    const r = deserialize(JSON.stringify(v1));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data).toMatchObject({ version: SAVE_VERSION, credits: 2500, systemId: 'sol', visited: ['sol'], landedAt: null, captain: null });
    expect(r.data.ship).toEqual({ ...v1.ship, defId: 'prototype' });
    expect('fuel' in r.data).toBe(false);
  });

  it('upgrades a v2 save: drops fuel, keeps landing site, becomes the one legendary ship', () => {
    const v2 = { version: 2, createdAt: 1, updatedAt: 2, rngSeed: 5, credits: 900, systemId: 'alpha-centauri', ship: { defId: 'corvette', x: 1, y: 2, angle: 0 }, fuel: 1, visited: ['sol', 'alpha-centauri'], landedAt: 'terminator-city' };
    const r = deserialize(JSON.stringify(v2));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data).toMatchObject({ credits: 900, landedAt: 'terminator-city', shipName: 'Wayfarer', upgrades: {}, cargo: {}, locker: {}, captain: null });
    expect(r.data.ship.defId).toBe('prototype');
    expect('fuel' in r.data).toBe(false);
  });

  it('round-trips', () => {
    expect(deserialize(serialize(sample))).toEqual({ status: 'ok', data: sample });
  });

  it('round-trips through an export code, including non-ASCII text', () => {
    const named = { ...sample, systemId: 'sol-é' };
    expect(importSave(exportSave(named))).toEqual({ status: 'ok', data: named });
  });

  it('rejects corrupt or hostile data instead of half-loading it', () => {
    expect(deserialize('{nope').status).toBe('corrupt');
    expect(deserialize('null').status).toBe('corrupt');
    expect(deserialize(JSON.stringify({ ...sample, credits: -5 })).status).toBe('corrupt');
    expect(deserialize(JSON.stringify({ ...sample, version: SAVE_VERSION + 1 })).status).toBe('corrupt');
    expect(importSave('!!!not base64').status).toBe('corrupt');
  });
});
