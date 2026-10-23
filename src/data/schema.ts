import { z } from 'zod';
import shipsJson from './ships.json';
import systemsJson from './systems.json';

/**
 * All game content lives in JSON and is validated here, including
 * cross-references (a system that names a missing ship is a build error,
 * not a crash on the player's phone).
 */
const id = z.string().regex(/^[a-z0-9-]+$/, 'ids are lowercase-kebab');

export const ShipDefSchema = z.object({
  id,
  name: z.string().min(1),
  hull: z.number().positive(),
  shields: z.number().nonnegative(),
  thrust: z.number().positive(),
  maxSpeed: z.number().positive(),
  turnRate: z.number().positive(),
  drag: z.number().nonnegative(),
  cargo: z.number().int().nonnegative(),
  price: z.number().int().nonnegative(),
});
export type ShipDef = z.infer<typeof ShipDefSchema>;

export const StarSystemSchema = z.object({
  id,
  name: z.string().min(1),
  x: z.number(),
  y: z.number(),
  links: z.array(id),
  shipyard: z.array(id),
});
export type StarSystem = z.infer<typeof StarSystemSchema>;

export interface GameData {
  ships: ReadonlyMap<string, ShipDef>;
  systems: ReadonlyMap<string, StarSystem>;
}

function indexById<T extends { id: string }>(items: T[], kind: string, errors: string[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) errors.push(`duplicate ${kind} id "${item.id}"`);
    map.set(item.id, item);
  }
  return map;
}

export function buildGameData(rawShips: unknown, rawSystems: unknown): GameData {
  const ships = z.array(ShipDefSchema).parse(rawShips);
  const systems = z.array(StarSystemSchema).parse(rawSystems);
  const errors: string[] = [];
  const shipMap = indexById(ships, 'ship', errors);
  const systemMap = indexById(systems, 'system', errors);

  for (const sys of systems) {
    for (const link of sys.links) {
      const other = systemMap.get(link);
      if (!other) errors.push(`system "${sys.id}" links to missing system "${link}"`);
      else if (!other.links.includes(sys.id)) errors.push(`jump link "${sys.id}" -> "${link}" is one-way`);
      if (link === sys.id) errors.push(`system "${sys.id}" links to itself`);
    }
    for (const shipId of sys.shipyard) {
      if (!shipMap.has(shipId)) errors.push(`system "${sys.id}" sells missing ship "${shipId}"`);
    }
  }
  if (errors.length > 0) throw new Error(`Game data invalid:\n- ${errors.join('\n- ')}`);
  return { ships: shipMap, systems: systemMap };
}

export const gameData: GameData = buildGameData(shipsJson, systemsJson);
