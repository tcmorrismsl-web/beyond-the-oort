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
