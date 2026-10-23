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
  cruiseMultiplier: z.number().min(1).max(5).default(1), // 1 = no cruise boost
  cargo: z.number().int().nonnegative(),
  fuel: z.number().int().positive().default(3), // jumps on a full tank
  price: z.number().int().nonnegative(),
});
export type ShipDef = z.infer<typeof ShipDefSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colors are #rrggbb');

/** What a landing site offers. Each site lists only what it actually has. */
export const SERVICES = ['refuel', 'trade', 'shipyard', 'outfitter', 'missions', 'bar', 'repair'] as const;
export type Service = (typeof SERVICES)[number];

/**
 * A place you can land: a city spaceport, a mining camp, a fuel depot...
 * A planet can have several (pick one when landing); a station usually has
 * one or two decks. `notes` gives each service its own local flavor.
 */
export const SiteSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(['city', 'spaceport', 'settlement', 'outpost', 'station', 'depot', 'mining', 'research', 'ruins']),
  description: z.string().min(1),
  services: z.array(z.enum(SERVICES)),
  notes: z.partialRecord(z.enum(SERVICES), z.string().min(1)).default({}),
});
export type Site = z.infer<typeof SiteSchema>;

/** A planet, moon or station inside a system. Positions are in-system world units; the star sits at 0,0. */
export const BodySchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(['planet', 'moon', 'gas-giant', 'station', 'star-remnant']),
  x: z.number(),
  y: z.number(),
  radius: z.number().positive().max(400),
  color: hexColor,
  description: z.string().default(''),
  /** Where you can land. Empty = you can't land here (gas giants, dead worlds). */
  sites: z.array(SiteSchema).default([]),
});
export type Body = z.infer<typeof BodySchema>;

export const StarSystemSchema = z.object({
  id,
  name: z.string().min(1),
  x: z.number(), // position on the galaxy map (real 3D distances, flattened)
  y: z.number(),
  distanceLy: z.number().nonnegative().default(0), // real distance from Sol
  spectral: z.string().default(''), // real spectral class
  description: z.string().default(''),
  star: z.object({ color: hexColor, radius: z.number().positive().max(400) }).default({ color: '#ffd27a', radius: 90 }),
  links: z.array(id),
  shipyard: z.array(id),
  bodies: z.array(BodySchema).default([]),
});
export type StarSystem = z.infer<typeof StarSystemSchema>;

export function isLandable(body: Body): boolean {
  return body.sites.length > 0;
}

export interface GameData {
  ships: ReadonlyMap<string, ShipDef>;
  systems: ReadonlyMap<string, StarSystem>;
  /** Every planet/station by id, with the system it belongs to. */
  bodies: ReadonlyMap<string, { body: Body; systemId: string }>;
  /** Every landing site by id, with its body and system. */
  sites: ReadonlyMap<string, { site: Site; body: Body; systemId: string }>;
}

/** Bodies must sit clear of their star by at least this much (so nobody spawns inside the sun). */
const STAR_CLEARANCE = 150;

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
  const bodyMap = new Map<string, { body: Body; systemId: string }>();
  const siteMap = new Map<string, { site: Site; body: Body; systemId: string }>();

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
    for (const body of sys.bodies) {
      if (bodyMap.has(body.id)) errors.push(`duplicate body id "${body.id}"`);
      bodyMap.set(body.id, { body, systemId: sys.id });
      if (Math.hypot(body.x, body.y) < sys.star.radius + body.radius + STAR_CLEARANCE) {
        errors.push(`body "${body.id}" is too close to the star in "${sys.id}"`);
      }
      for (const site of body.sites) {
        if (siteMap.has(site.id) || bodyMap.has(site.id)) errors.push(`duplicate site id "${site.id}"`);
        siteMap.set(site.id, { site, body, systemId: sys.id });
        for (const noted of Object.keys(site.notes)) {
          if (!site.services.includes(noted as Service)) errors.push(`site "${site.id}" has a note for "${noted}" but doesn't offer it`);
        }
        if (new Set(site.services).size !== site.services.length) errors.push(`site "${site.id}" lists a service twice`);
      }
    }
    const refuels = sys.bodies.some((b) => b.sites.some((st) => st.services.includes('refuel')));
    if (!refuels) errors.push(`system "${sys.id}" has nowhere to refuel (add a fuel depot)`);
  }
  if (errors.length > 0) throw new Error(`Game data invalid:\n- ${errors.join('\n- ')}`);
  return { ships: shipMap, systems: systemMap, bodies: bodyMap, sites: siteMap };
}

export const gameData: GameData = buildGameData(shipsJson, systemsJson);
