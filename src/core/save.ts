import { z } from 'zod';
import { readKey, writeKey, type StorageResult } from './storage';

/**
 * Versioned saves. Rules:
 *  - Any change to SaveData bumps SAVE_VERSION and adds a migration from the
 *    previous version. Old saves must load forever; a player's 20-hour save
 *    is the most valuable thing in the game.
 *  - Every load is validated. A corrupt save is reported, never half-loaded.
 */
export const SAVE_VERSION = 4;
const SAVE_KEY = 'game.save';

export const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  createdAt: z.number(),
  updatedAt: z.number(),
  rngSeed: z.number().int().nonnegative(),
  credits: z.number().int().nonnegative(),
  systemId: z.string().min(1),
  ship: z.object({
    defId: z.string().min(1),
    x: z.number(),
    y: z.number(),
    angle: z.number(),
  }),
  visited: z.array(z.string().min(1)),
  landedAt: z.string().min(1).nullable(),
  /** Who you are (character creation). Null for saves from before it existed. */
  captain: z
    .object({
      name: z.string().min(1).max(40),
      pronouns: z.enum(['she', 'he', 'they']),
      origin: z.string().min(1),
      moment: z.string().min(1),
      motive: z.string().min(1),
    })
    .nullable(),
  shipName: z.string().min(1).max(40),
  /** Upgrade tiers owned, by track id (0 or missing = stock). */
  upgrades: z.record(z.string(), z.number().int().nonnegative()),
  /** Trade goods in the hold, by commodity id. */
  cargo: z.record(z.string(), z.number().int().positive()),
  /** Mission items, artifacts and discoveries — unlimited. */
  locker: z.record(z.string(), z.number().int().positive()),
  /** Story flags set by conversations and missions (what you know, who you've met). */
  flags: z.array(z.string().min(1)),
});
export type SaveData = z.infer<typeof SaveSchema>;

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;
/** migrations[n] upgrades a version-n save to version n+1. */
const migrations: Record<number, Migration> = {
  // v1 → v2 (Milestone 2: galaxy & travel): fuel, visited systems, landed location.
  // Fuel starts at 3 (every ship holds at least 3; landing refills to full).
  1: (old) => ({
    ...old,
    fuel: 3,
    visited: typeof old['systemId'] === 'string' ? [old['systemId']] : [],
    landedAt: null,
  }),
  // v2 → v3 (Milestone 3: captain & ship): fuel removed (free everywhere);
  // one legendary ship ("prototype") replaces the shuttle/corvette; captain,
  // ship name, upgrades, cargo hold and locker added. Credits are kept.
  2: (old) => {
    const rest: Record<string, unknown> = { ...old };
    delete rest['fuel'];
    const ship = typeof old['ship'] === 'object' && old['ship'] !== null ? (old['ship'] as Record<string, unknown>) : {};
    return {
      ...rest,
      ship: { ...ship, defId: 'prototype' },
      captain: null,
      shipName: 'Wayfarer',
      upgrades: {},
      cargo: {},
      locker: {},
    };
  },
  // v3 → v4 (Milestone 4: dialogue & story): story flags.
  3: (old) => ({ ...old, flags: [] }),
};

export type LoadResult =
  | { status: 'ok'; data: SaveData }
  | { status: 'empty' }
  | { status: 'corrupt'; reason: string };

export function serialize(data: SaveData): string {
  return JSON.stringify(SaveSchema.parse(data));
}

export function deserialize(raw: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: 'not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 'corrupt', reason: 'not an object' };

  let obj = parsed as Record<string, unknown>;
  let version = typeof obj['version'] === 'number' ? obj['version'] : NaN;
  if (!Number.isInteger(version)) return { status: 'corrupt', reason: 'missing version' };
  if (version > SAVE_VERSION) return { status: 'corrupt', reason: `save is from a newer build (v${version})` };

  while (version < SAVE_VERSION) {
    const migrate = migrations[version];
    if (!migrate) return { status: 'corrupt', reason: `no migration from v${version}` };
    obj = migrate(obj);
    version += 1;
    obj['version'] = version;
  }

  const result = SaveSchema.safeParse(obj);
  return result.success
    ? { status: 'ok', data: result.data }
    : { status: 'corrupt', reason: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

export function loadGame(): LoadResult {
  const raw = readKey(SAVE_KEY);
  return raw === null ? { status: 'empty' } : deserialize(raw);
}

export function saveGame(data: SaveData): StorageResult {
  return writeKey(SAVE_KEY, serialize({ ...data, updatedAt: Date.now() }));
}

/** Text the player can copy somewhere safe; Safari storage can be cleared. */
export function exportSave(data: SaveData): string {
  const bytes = new TextEncoder().encode(serialize(data));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function importSave(code: string): LoadResult {
  try {
    const binary = atob(code.trim());
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return deserialize(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { status: 'corrupt', reason: 'not a valid save code' };
  }
}

/**
 * Copy an unreadable save aside before anything can overwrite it. A future
 * build (or a person helping the player) may still be able to rescue it.
 */
export function backupCorruptSave(now: number): StorageResult {
  const raw = readKey(SAVE_KEY);
  if (raw === null) return { ok: true };
  return writeKey(`${SAVE_KEY}.corrupt-${now}`, raw);
}
