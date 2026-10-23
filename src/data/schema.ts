import { z } from 'zod';
import shipsJson from './ships.json';
import systemsJson from './systems.json';
import upgradesJson from './upgrades.json';
import commoditiesJson from './commodities.json';
import originsJson from './origins.json';
import dialoguesJson from './dialogues.json';

/**
 * All game content lives in JSON and is validated here, including
 * cross-references (a market that names a missing commodity is a build
 * error, not a crash on the player's phone).
 */
const id = z.string().regex(/^[a-z0-9-]+$/, 'ids are lowercase-kebab');

/** Your one-of-a-kind ship's stock stats. Upgrades scale these (see systems/ship.ts). */
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
});
export type ShipDef = z.infer<typeof ShipDefSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colors are #rrggbb');

/** What a landing site offers. Each site lists only what it actually has. */
export const SERVICES = ['trade', 'drydock', 'missions', 'bar', 'repair'] as const;
export type Service = (typeof SERVICES)[number];

export const SITE_KINDS = ['city', 'spaceport', 'settlement', 'outpost', 'station', 'waystation', 'mining', 'research', 'ruins'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

/**
 * A place you can land: a city spaceport, a mining camp, a waystation...
 * A planet can have several (pick one when landing); a station usually has
 * one or two decks. `notes` gives each service its own local flavor;
 * `market` overrides which goods are cheap or dear here.
 */
export const SiteSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(SITE_KINDS),
  description: z.string().min(1),
  services: z.array(z.enum(SERVICES)),
  notes: z.partialRecord(z.enum(SERVICES), z.string().min(1)).default({}),
  market: z.object({ cheap: z.array(id).default([]), dear: z.array(id).default([]) }).optional(),
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
  bodies: z.array(BodySchema).default([]),
});
export type StarSystem = z.infer<typeof StarSystemSchema>;

/** One upgrade track for your ship (engines, cargo hold...), bought tier by tier at drydocks. */
export const UpgradeEffectSchema = z.object({
  thrust: z.number().min(1).optional(), // multipliers on stock values
  maxSpeed: z.number().min(1).optional(),
  turnRate: z.number().min(1).optional(),
  cruiseMultiplier: z.number().min(1).max(5).optional(), // absolute value
  cargo: z.number().int().nonnegative().optional(), // added
  hull: z.number().nonnegative().optional(), // added
  shields: z.number().nonnegative().optional(), // added
});
export type UpgradeEffect = z.infer<typeof UpgradeEffectSchema>;

export const UpgradeTrackSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().min(1),
  note: z.string().optional(),
  tiers: z.array(z.object({ name: z.string().min(1), cost: z.number().int().positive(), effect: UpgradeEffectSchema })).min(1),
});
export type UpgradeTrack = z.infer<typeof UpgradeTrackSchema>;

export const CommoditySchema = z.object({
  id,
  name: z.string().min(1),
  basePrice: z.number().int().positive(),
  cheapAt: z.array(z.enum(SITE_KINDS)).default([]),
  dearAt: z.array(z.enum(SITE_KINDS)).default([]),
});
export type Commodity = z.infer<typeof CommoditySchema>;

const ChoiceSchema = z.object({
  id,
  name: z.string().min(1),
  blurb: z.string().min(1),
  text: z.string().min(1),
  credits: z.number().int().default(0),
  shipStory: z.string().optional(),
});
export type CreationChoice = z.infer<typeof ChoiceSchema>;

/** Character-creation options (Mass Effect-inspired, original content). */
export const OriginsSchema = z.object({
  origins: z.array(ChoiceSchema),
  moments: z.array(ChoiceSchema),
  motives: z.array(ChoiceSchema),
  ship: z.object({ intro: z.string(), nameSuggestions: z.array(z.string().min(1)) }),
});
export type Origins = z.infer<typeof OriginsSchema>;

/** When a dialogue choice is offered. All listed conditions must hold. */
export const ConditionSchema = z.object({
  origin: z.array(id).optional(),
  moment: z.array(id).optional(),
  motive: z.array(id).optional(),
  pronouns: z.array(z.enum(['she', 'he', 'they'])).optional(),
  flag: id.optional(),
  notFlag: id.optional(),
  minCredits: z.number().int().nonnegative().optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

/** What a dialogue choice does. */
export const EffectSchema = z.object({
  setFlag: id.optional(),
  clearFlag: id.optional(),
  credits: z.number().int().optional(),
  locker: z.object({ item: id, qty: z.number().int().positive() }).optional(),
});
export type Effect = z.infer<typeof EffectSchema>;

export const ChoiceSchemaD = z.object({
  text: z.string().min(1),
  to: id.nullable(), // null ends the conversation
  if: ConditionSchema.optional(),
  effects: z.array(EffectSchema).default([]),
});

/**
 * A branching conversation. Text can use {name}, {ship}, {they}, {them},
 * {their} (from the captain). Choices can depend on your background and
 * story flags, and can set flags for later conversations and missions.
 */
export const DialogueSchema = z.object({
  id,
  title: z.string().min(1),
  speaker: z.string().min(1),
  role: z.string().default(''),
  site: id.optional(), // where you can find this conversation
  start: id,
  nodes: z.record(id, z.object({ text: z.string().min(1), choices: z.array(ChoiceSchemaD).min(1) })),
});
export type Dialogue = z.infer<typeof DialogueSchema>;

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
  upgrades: readonly UpgradeTrack[];
  commodities: ReadonlyMap<string, Commodity>;
  creation: Origins;
  dialogues: ReadonlyMap<string, Dialogue>;
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

const EMPTY_ORIGINS = { origins: [], moments: [], motives: [], ship: { intro: '', nameSuggestions: [] } };

export interface RawContent {
  ships: unknown;
  systems: unknown;
  upgrades?: unknown;
  commodities?: unknown;
  origins?: unknown;
  dialogues?: unknown;
}

export function buildGameData(raw: RawContent): GameData {
  const ships = z.array(ShipDefSchema).parse(raw.ships);
  const systems = z.array(StarSystemSchema).parse(raw.systems);
  const upgrades = z.array(UpgradeTrackSchema).parse(raw.upgrades ?? []);
  const commodities = z.array(CommoditySchema).parse(raw.commodities ?? []);
  const creation = OriginsSchema.parse(raw.origins ?? EMPTY_ORIGINS);
  const dialogues = z.array(DialogueSchema).parse(raw.dialogues ?? []);
  const errors: string[] = [];
  const shipMap = indexById(ships, 'ship', errors);
  const systemMap = indexById(systems, 'system', errors);
  const commodityMap = indexById(commodities, 'commodity', errors);
  indexById(upgrades, 'upgrade', errors);
  for (const list of [creation.origins, creation.moments, creation.motives]) indexById(list, 'creation choice', errors);
  const bodyMap = new Map<string, { body: Body; systemId: string }>();
  const siteMap = new Map<string, { site: Site; body: Body; systemId: string }>();

  for (const sys of systems) {
    for (const link of sys.links) {
      const other = systemMap.get(link);
      if (!other) errors.push(`system "${sys.id}" links to missing system "${link}"`);
      else if (!other.links.includes(sys.id)) errors.push(`jump link "${sys.id}" -> "${link}" is one-way`);
      if (link === sys.id) errors.push(`system "${sys.id}" links to itself`);
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
        if (site.market) {
          if (!site.services.includes('trade')) errors.push(`site "${site.id}" has market prices but no trade service`);
          for (const c of [...site.market.cheap, ...site.market.dear]) {
            if (!commodityMap.has(c)) errors.push(`site "${site.id}" market names missing commodity "${c}"`);
          }
        }
      }
    }
  }
  for (const track of upgrades) {
    let lastCost = 0;
    for (const tier of track.tiers) {
      if (tier.cost <= lastCost) errors.push(`upgrade "${track.id}" tier "${tier.name}" must cost more than the tier before`);
      lastCost = tier.cost;
    }
  }
  for (const c of commodities) {
    if (c.cheapAt.some((k) => c.dearAt.includes(k))) errors.push(`commodity "${c.id}" is both cheap and dear at the same kind of site`);
  }
  const dialogueMap = indexById(dialogues, 'dialogue', errors);
  const known = {
    origin: new Set(creation.origins.map((o) => o.id)),
    moment: new Set(creation.moments.map((o) => o.id)),
    motive: new Set(creation.motives.map((o) => o.id)),
  };
  for (const d of dialogues) validateDialogue(d, known, siteMap, errors);
  if (errors.length > 0) throw new Error(`Game data invalid:\n- ${errors.join('\n- ')}`);
  return { ships: shipMap, systems: systemMap, bodies: bodyMap, sites: siteMap, upgrades, commodities: commodityMap, creation, dialogues: dialogueMap };
}

/**
 * Conversations must hang together: every link goes somewhere real, every
 * node is reachable, nobody can get stuck (each node has at least one
 * choice with no condition), and conditions only name real backgrounds.
 */
function validateDialogue(
  d: Dialogue,
  known: Record<'origin' | 'moment' | 'motive', ReadonlySet<string>>,
  sites: ReadonlyMap<string, unknown>,
  errors: string[],
): void {
  const where = `dialogue "${d.id}"`;
  if (!(d.start in d.nodes)) errors.push(`${where} starts at missing node "${d.start}"`);
  if (d.site !== undefined && !sites.has(d.site)) errors.push(`${where} is placed at missing site "${d.site}"`);
  for (const [nodeId, node] of Object.entries(d.nodes)) {
    if (!node.choices.some((c) => c.if === undefined)) errors.push(`${where} node "${nodeId}" can strand the player (every choice has a condition)`);
    for (const c of node.choices) {
      if (c.to !== null && !(c.to in d.nodes)) errors.push(`${where} node "${nodeId}" links to missing node "${c.to}"`);
      for (const key of ['origin', 'moment', 'motive'] as const) {
        for (const v of c.if?.[key] ?? []) if (!known[key].has(v)) errors.push(`${where} node "${nodeId}" checks unknown ${key} "${v}"`);
      }
    }
  }
  const seen = new Set<string>([d.start]);
  const queue = [d.start];
  while (queue.length > 0) {
    const node = d.nodes[queue.shift() ?? ''];
    for (const c of node?.choices ?? []) {
      if (c.to !== null && !seen.has(c.to)) {
        seen.add(c.to);
        queue.push(c.to);
      }
    }
  }
  for (const nodeId of Object.keys(d.nodes)) if (!seen.has(nodeId)) errors.push(`${where} node "${nodeId}" can never be reached`);
}

export const gameData: GameData = buildGameData({
  ships: shipsJson,
  systems: systemsJson,
  upgrades: upgradesJson,
  commodities: commoditiesJson,
  origins: originsJson,
  dialogues: dialoguesJson,
});
