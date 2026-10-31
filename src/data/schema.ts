import { z } from 'zod';
import shipsJson from './ships.json';
import systemsJson from './systems.json';
import upgradesJson from './upgrades.json';
import commoditiesJson from './commodities.json';
import originsJson from './origins.json';
import appearanceJson from './appearance.json';
import itemsJson from './items.json';
import logJson from './log.json';
import charactersJson from './characters.json';
import poisJson from './pois.json';
import missionsJson from './missions.json';

/** Walkable places (wrecks, camps, stations), one file each in data/interiors/. */
const interiorFiles = import.meta.glob<{ default: unknown }>('./interiors/*.json', { eager: true });
const interiorsJson: unknown[] = Object.keys(interiorFiles)
  .sort()
  .map((k) => interiorFiles[k]?.default);

/** Conversations live one file per story beat or character in data/dialogues/. */
const dialogueFiles = import.meta.glob<{ default: unknown[] }>('./dialogues/*.json', { eager: true });
const dialoguesJson: unknown[] = Object.keys(dialogueFiles)
  .sort()
  .flatMap((k) => dialogueFiles[k]?.default ?? []);

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
  /** Shown instead of a service list at a place with no services (a quiet dock, an empty camp). */
  emptyNote: z.string().min(1).optional(),
  /** A place here you can walk around in (on foot). */
  interior: z.lazy(() => EntrySchema).optional(),
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
  /** All of these flags. */
  allFlags: z.array(id).optional(),
  /** At least one of these flags. */
  anyFlag: z.array(id).optional(),
  /** None of these flags. */
  noFlags: z.array(id).optional(),
  minCredits: z.number().int().nonnegative().optional(),
  /** This character is aboard your ship. */
  crew: id.optional(),
  notCrew: id.optional(),
  /** This character's approval of you is at least `value`. */
  minAffinity: z.object({ who: id, value: z.number().int() }).optional(),
  /** This character is open to romance with you right now (see systems/crew.ts). */
  romance: id.optional(),
  /** You carry this item in the locker. */
  hasItem: id.optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

/** What a dialogue choice does. */
export const EffectSchema = z.object({
  setFlag: id.optional(),
  clearFlag: id.optional(),
  credits: z.number().int().optional(),
  locker: z.object({ item: id, qty: z.number().int().positive() }).optional(),
  /** Take an item out of the locker (handing it over). */
  removeItem: id.optional(),
  /** Change one character's approval of you. */
  affinity: z.object({ who: id, by: z.number().int().min(-5).max(5) }).optional(),
  /** A character comes aboard / leaves the ship. */
  join: id.optional(),
  leave: id.optional(),
});
export type Effect = z.infer<typeof EffectSchema>;

export const ChoiceSchemaD = z.object({
  text: z.string().min(1),
  to: id.nullable(), // null ends the conversation
  if: ConditionSchema.optional(),
  effects: z.array(EffectSchema).default([]),
  /** Mark as flirting (shown with a heart). Choices gated on `romance` are marked automatically. */
  flirt: z.boolean().optional(),
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
  /** Who's talking, for their portrait (a character id). */
  character: id.optional(),
  // Where it happens — exactly one of these:
  site: id.optional(), // at a landing site
  /** A story event that plays in flight once its condition is met (e.g. an incoming transmission). */
  trigger: z.object({ if: ConditionSchema }).optional(),
  poi: id.optional(), // at a point of interest in space ("Investigate")
  crew: id.optional(), // aboard your ship, with this crew member (Ship screen)
  spot: z.object({ interior: id, id }).optional(), // a spot inside a walkable place (on foot)
  /** Transmissions only: plays as a scene aboard your ship rather than an incoming call. */
  aboard: z.boolean().optional(),
  /** When it's available (site, poi and crew conversations). */
  if: ConditionSchema.optional(),
  start: id,
  nodes: z.record(
    id,
    z.object({
      text: z.string().min(1),
      /** Presentation: fade to black (romance), or a title card (end of an act). */
      mood: z.enum(['fade', 'title']).optional(),
      choices: z.array(ChoiceSchemaD).min(1),
    }),
  ),
});
export type Dialogue = z.infer<typeof DialogueSchema>;

/** Things that go in the locker (mission items, recordings, artifacts). */
export const ItemSchema = z.object({ id, name: z.string().min(1), description: z.string().min(1) });
export type Item = z.infer<typeof ItemSchema>;

/** Story log: an entry appears once its flag is set. */
export const LogEntrySchema = z.object({ flag: id, title: z.string().min(1), text: z.string().min(1) });
export type LogEntry = z.infer<typeof LogEntrySchema>;

const NamedOption = z.object({ id, name: z.string().min(1) });

const PRONOUNS = ['she', 'he', 'they'] as const;

/**
 * Anyone with a face: crew, love interests, voices on the radio. One
 * character system for everyone; flags in the data decide who can join the
 * crew (`home`) or be romanced (`romance`).
 */
export const CharacterSchema = z.object({
  id,
  name: z.string().min(1),
  pronouns: z.enum(PRONOUNS),
  role: z.string().min(1),
  bio: z.string().min(1),
  look: z.object({
    face: id,
    skin: hexColor,
    hair: id,
    hairColor: hexColor,
    eyes: hexColor,
    outfit: id,
    outfitColor: hexColor,
    beard: id,
  }),
  /** Where they wait when they're not aboard. Only crew-capable characters have one. */
  home: id.optional(),
  /**
   * Romance. `leans`: which captains they're usually drawn to (by pronouns;
   * they/them captains always count). `at`: approval needed to flirt.
   * `pastLean`: extra approval needed to win them over otherwise.
   */
  romance: z
    .object({
      leans: z.union([z.literal('any'), z.array(z.enum(PRONOUNS)).min(1)]),
      at: z.number().int().min(0),
      pastLean: z.number().int().min(0),
    })
    .nullable()
    .default(null),
});
export type Character = z.infer<typeof CharacterSchema>;

/** Something to find in space: a wreck, a beacon, a reading point. Fly close and tap Investigate. */
export const PoiSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(['derelict', 'beacon', 'signal', 'anomaly']),
  system: id,
  x: z.number(),
  y: z.number(),
  description: z.string().min(1),
  /** When it shows up in space (hidden until then). */
  if: ConditionSchema.optional(),
  /** You can board it and walk around (when the entry's condition holds; otherwise Investigate plays its conversation). */
  interior: z.lazy(() => EntrySchema).optional(),
});
export type Poi = z.infer<typeof PoiSchema>;

/** Where a mission step takes you. */
export const TargetSchema = z.object({ system: id, site: id.optional(), poi: id.optional() });
export type Target = z.infer<typeof TargetSchema>;

/**
 * A mission is a story thread in your journal. Its progress is read from
 * story flags (nothing extra is saved), so a mission can never disagree with
 * what actually happened in conversations.
 */
export const MissionSchema = z.object({
  id,
  title: z.string().min(1),
  kind: z.enum(['main', 'side', 'companion']),
  summary: z.string().min(1),
  /** When it appears in the journal. */
  startIf: ConditionSchema,
  /**
   * Side stories: a lead posted on Jobs boards. Taking it sets `flag` (put that
   * flag in startIf). Shown only while the mission hasn't started and `if` holds.
   */
  board: z.object({ text: z.string().min(1), flag: id, if: ConditionSchema.optional() }).optional(),
  steps: z
    .array(z.object({ text: z.string().min(1), doneIf: ConditionSchema, target: TargetSchema.optional() }))
    .min(1),
});
export type Mission = z.infer<typeof MissionSchema>;

/** A way into a walkable place, from a landing site or a point of interest. */
export const EntrySchema = z.object({ id, label: z.string().min(1), if: ConditionSchema.optional() });
export type Entry = z.infer<typeof EntrySchema>;

/**
 * Tile legend for walkable places. Solid tiles block walking.
 *   #  wall          .  floor        +  doorway (floor)   (space) outside (solid)
 *   t  table         b  bunk         c  crate             k  console
 *   d  dish/machine  p  plant bed    ~  frost/debris (floor, drawn as clutter)
 */
export const TILE_SOLID: Readonly<Record<string, boolean>> = { '#': true, ' ': true, t: true, b: true, c: true, k: true, d: true, p: true, '.': false, '+': false, '~': false };

/**
 * A place you walk around in, top-down: a wreck, a camp, a station. The map
 * is ASCII rows (see TILE_SOLID); positions are in tiles (x = column, y = row,
 * may be fractional). Spots are the things to look at; each plays the first
 * available conversation placed at it. `auto` spots play when you walk onto them.
 */
export const InteriorSchema = z.object({
  id,
  name: z.string().min(1),
  theme: z.enum(['derelict', 'camp', 'station']),
  /** Dark places are lit only by your flashlight. */
  dark: z.boolean().default(false),
  map: z.array(z.string().min(1)).min(3),
  spawn: z.object({ x: z.number(), y: z.number() }),
  exit: z.object({ x: z.number(), y: z.number(), label: z.string().min(1) }),
  spots: z.array(z.object({ id, x: z.number(), y: z.number(), label: z.string().min(1), auto: z.boolean().default(false) })),
  /** People standing here (when their condition holds). Tapping them plays the conversation at their spot. */
  people: z.array(z.object({ character: id, x: z.number(), y: z.number(), spot: id, if: ConditionSchema.optional() })).default([]),
});
export type Interior = z.infer<typeof InteriorSchema>;

/** True if a tile position is somewhere a person can stand. */
export function walkableTile(map: readonly string[], x: number, y: number): boolean {
  const ch = map[Math.floor(y)]?.[Math.floor(x)];
  return ch !== undefined && TILE_SOLID[ch] === false;
}

/** Appearance options for the captain's portrait and the ship's paint. */
export const AppearanceSchema = z.object({
  captain: z.object({
    faces: z.array(NamedOption).min(1),
    skinTones: z.array(hexColor).min(1),
    hairStyles: z.array(NamedOption).min(1),
    hairColors: z.array(hexColor).min(1),
    eyeColors: z.array(hexColor).min(1),
    outfits: z.array(NamedOption).min(1),
    outfitColors: z.array(hexColor).min(1),
    beards: z.array(NamedOption).min(1),
  }),
  ship: z.object({
    hullColors: z.array(hexColor).min(1),
    accentColors: z.array(hexColor).min(1),
    patterns: z.array(NamedOption).min(1),
    glowColors: z.array(hexColor).min(1),
  }),
  repaintCost: z.number().int().nonnegative(),
});
export type AppearanceOptions = z.infer<typeof AppearanceSchema>;

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
  appearance: AppearanceOptions;
  items: ReadonlyMap<string, Item>;
  log: readonly LogEntry[];
  characters: ReadonlyMap<string, Character>;
  pois: ReadonlyMap<string, Poi>;
  missions: readonly Mission[];
  interiors: ReadonlyMap<string, Interior>;
}

/** Flags the engine sets by itself (not from conversations). */
export const ENGINE_FLAGS = ['landed-once'] as const;

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

const DEFAULT_APPEARANCE = {
  captain: {
    faces: [{ id: 'oval', name: 'Oval' }],
    skinTones: ['#d9a37e'],
    hairStyles: [{ id: 'short', name: 'Short' }],
    hairColors: ['#3b2416'],
    eyeColors: ['#3b2a1d'],
    outfits: [{ id: 'flight-jacket', name: 'Flight jacket' }],
    outfitColors: ['#2b3a55'],
    beards: [{ id: 'none', name: 'None' }],
  },
  ship: { hullColors: ['#dfe8ff'], accentColors: ['#4fc3ff'], patterns: [{ id: 'plain', name: 'Plain' }], glowColors: ['#ffa040'] },
  repaintCost: 0,
};

const EMPTY_ORIGINS = { origins: [], moments: [], motives: [], ship: { intro: '', nameSuggestions: [] } };

export interface RawContent {
  ships: unknown;
  systems: unknown;
  upgrades?: unknown;
  commodities?: unknown;
  origins?: unknown;
  dialogues?: unknown;
  appearance?: unknown;
  items?: unknown;
  log?: unknown;
  characters?: unknown;
  pois?: unknown;
  missions?: unknown;
  interiors?: unknown;
}

export function buildGameData(raw: RawContent): GameData {
  const ships = z.array(ShipDefSchema).parse(raw.ships);
  const systems = z.array(StarSystemSchema).parse(raw.systems);
  const upgrades = z.array(UpgradeTrackSchema).parse(raw.upgrades ?? []);
  const commodities = z.array(CommoditySchema).parse(raw.commodities ?? []);
  const creation = OriginsSchema.parse(raw.origins ?? EMPTY_ORIGINS);
  const dialogues = z.array(DialogueSchema).parse(raw.dialogues ?? []);
  const appearance = AppearanceSchema.parse(raw.appearance ?? DEFAULT_APPEARANCE);
  const items = z.array(ItemSchema).parse(raw.items ?? []);
  const log = z.array(LogEntrySchema).parse(raw.log ?? []);
  const characters = z.array(CharacterSchema).parse(raw.characters ?? []);
  const pois = z.array(PoiSchema).parse(raw.pois ?? []);
  const missions = z.array(MissionSchema).parse(raw.missions ?? []);
  const interiors = z.array(InteriorSchema).parse(raw.interiors ?? []);
  const errors: string[] = [];
  const interiorMap = indexById(interiors, 'interior', errors);
  for (const inside of interiors) validateInterior(inside, errors);
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
  const itemMap = indexById(items, 'item', errors);
  const characterMap = indexById(characters, 'character', errors);
  const poiMap = indexById(pois, 'point of interest', errors);
  indexById(missions, 'mission', errors);

  // Every flag that can ever be set; any condition naming another flag is a typo.
  const settable = new Set<string>(ENGINE_FLAGS);
  for (const d of dialogues) {
    for (const node of Object.values(d.nodes)) for (const c of node.choices) for (const e of c.effects) {
      if (e.setFlag !== undefined) settable.add(e.setFlag);
      if (e.join !== undefined) settable.add(`joined-${e.join}`);
    }
  }
  for (const m of missions) if (m.board) settable.add(m.board.flag);
  const refs = { characters: characterMap, items: itemMap, flags: settable };
  const checkCond = (cond: Condition | undefined, where: string): void => {
    checkCondition(cond, where, refs, errors);
  };

  for (const c of characters) {
    const a = appearance.captain;
    const l = c.look;
    const ok =
      a.faces.some((o) => o.id === l.face) && a.skinTones.includes(l.skin) && a.hairStyles.some((o) => o.id === l.hair) &&
      a.hairColors.includes(l.hairColor) && a.eyeColors.includes(l.eyes) && a.outfits.some((o) => o.id === l.outfit) &&
      a.outfitColors.includes(l.outfitColor) && a.beards.some((o) => o.id === l.beard);
    if (!ok) errors.push(`character "${c.id}" has a look that isn't one of the appearance options`);
    if (c.home !== undefined && !siteMap.has(c.home)) errors.push(`character "${c.id}" waits at missing site "${c.home}"`);
  }
  for (const p of pois) {
    const sys = systemMap.get(p.system);
    if (!sys) errors.push(`point of interest "${p.id}" is in missing system "${p.system}"`);
    else if (Math.hypot(p.x, p.y) < sys.star.radius + STAR_CLEARANCE) errors.push(`point of interest "${p.id}" is inside the star`);
    if (siteMap.has(p.id) || bodyMap.has(p.id)) errors.push(`point of interest "${p.id}" shares an id with a body or site`);
    checkCond(p.if, `point of interest "${p.id}"`);
  }
  for (const d of dialogues) {
    validateDialogue(d, known, siteMap, errors);
    const where = `dialogue "${d.id}"`;
    const placements = [d.site, d.trigger, d.poi, d.crew, d.spot].filter((x) => x !== undefined).length;
    if (placements === 0) errors.push(`${where} has no site, trigger, poi, crew or spot, so it can never be heard`);
    if (placements > 1) errors.push(`${where} is placed in more than one way (site/trigger/poi/crew/spot)`);
    if (d.spot !== undefined) {
      const inside = interiorMap.get(d.spot.interior);
      if (!inside) errors.push(`${where} is placed in missing interior "${d.spot.interior}"`);
      else if (!inside.spots.some((sp) => sp.id === d.spot?.id)) errors.push(`${where} is placed at missing spot "${d.spot.id}" in "${d.spot.interior}"`);
    }
    if (d.poi !== undefined && !poiMap.has(d.poi)) errors.push(`${where} is placed at missing point of interest "${d.poi}"`);
    if (d.crew !== undefined) {
      const who = characterMap.get(d.crew);
      if (!who) errors.push(`${where} is with missing crew member "${d.crew}"`);
      else if (who.home === undefined) errors.push(`${where} is aboard with "${d.crew}", who can't join the crew (no home)`);
    }
    if (d.character !== undefined && !characterMap.has(d.character)) errors.push(`${where} shows missing character "${d.character}"`);
    if (d.trigger !== undefined) {
      // A transmission must switch itself off, or it would replay forever.
      const off = d.trigger.if.notFlag;
      const sets = Object.values(d.nodes).some((n) => n.choices.some((c) => c.effects.some((e) => e.setFlag === off)));
      if (off === undefined || !sets) errors.push(`${where} is a transmission that never switches itself off (its trigger needs a notFlag that the conversation sets)`);
    }
    if (d.trigger !== undefined && d.if !== undefined) errors.push(`${where}: a transmission's condition belongs in trigger.if`);
    checkCond(d.trigger?.if, where);
    checkCond(d.if, where);
    for (const [nodeId, node] of Object.entries(d.nodes)) {
      for (const c of node.choices) {
        checkCond(c.if, `${where} node "${nodeId}"`);
        for (const e of c.effects) {
          if (e.locker && !itemMap.has(e.locker.item)) errors.push(`${where} gives missing item "${e.locker.item}"`);
          if (e.removeItem !== undefined && !itemMap.has(e.removeItem)) errors.push(`${where} takes missing item "${e.removeItem}"`);
          for (const who of [e.affinity?.who, e.join, e.leave]) {
            if (who !== undefined && !characterMap.has(who)) errors.push(`${where} node "${nodeId}" names missing character "${who}"`);
          }
          if (e.join !== undefined && characterMap.get(e.join)?.home === undefined) errors.push(`${where} node "${nodeId}" recruits "${e.join}", who has no home port`);
        }
      }
    }
  }
  const checkEntry = (e: Entry | undefined, where: string): void => {
    if (!e) return;
    if (!interiorMap.has(e.id)) errors.push(`${where} leads into missing interior "${e.id}"`);
    checkCond(e.if, where);
  };
  for (const p of pois) checkEntry(p.interior, `point of interest "${p.id}"`);
  for (const { site } of siteMap.values()) checkEntry(site.interior, `site "${site.id}"`);
  for (const inside of interiors) {
    for (const sp of inside.spots) {
      if (!dialogues.some((d) => d.spot?.interior === inside.id && d.spot.id === sp.id)) errors.push(`interior "${inside.id}" spot "${sp.id}" has no conversation`);
    }
    for (const person of inside.people) {
      if (!characterMap.has(person.character)) errors.push(`interior "${inside.id}" has missing character "${person.character}"`);
      if (!inside.spots.some((sp) => sp.id === person.spot)) errors.push(`interior "${inside.id}" person "${person.character}" talks at missing spot "${person.spot}"`);
      checkCond(person.if, `interior "${inside.id}" person "${person.character}"`);
    }
  }
  for (const m of missions) {
    const where = `mission "${m.id}"`;
    checkCond(m.startIf, where);
    if (m.board) {
      checkCond(m.board.if, `${where} board`);
      const starts = [m.startIf.flag, ...(m.startIf.anyFlag ?? [])].includes(m.board.flag);
      if (!starts) errors.push(`${where}: taking its board lead sets "${m.board.flag}", but startIf doesn't start on that flag`);
      if (!m.steps[0]?.target) errors.push(`${where}: a board lead needs a first step with a target (so the board can say where)`);
    }
    m.steps.forEach((step, i) => {
      checkCond(step.doneIf, `${where} step ${i + 1}`);
      const t = step.target;
      if (!t) return;
      if (!systemMap.has(t.system)) errors.push(`${where} step ${i + 1} targets missing system "${t.system}"`);
      if (t.site !== undefined && siteMap.get(t.site)?.systemId !== t.system) errors.push(`${where} step ${i + 1} targets site "${t.site}", which isn't in "${t.system}"`);
      if (t.poi !== undefined && poiMap.get(t.poi)?.system !== t.system) errors.push(`${where} step ${i + 1} targets point "${t.poi}", which isn't in "${t.system}"`);
    });
  }
  const logFlags = new Set<string>();
  for (const entry of log) {
    if (logFlags.has(entry.flag)) errors.push(`two log entries for flag "${entry.flag}"`);
    logFlags.add(entry.flag);
    if (!settable.has(entry.flag)) errors.push(`log entry "${entry.title}" waits for flag "${entry.flag}", which nothing sets`);
  }
  if (errors.length > 0) throw new Error(`Game data invalid:\n- ${errors.join('\n- ')}`);
  return { ships: shipMap, systems: systemMap, bodies: bodyMap, sites: siteMap, upgrades, commodities: commodityMap, creation, dialogues: dialogueMap, appearance, items: itemMap, log, characters: characterMap, pois: poiMap, missions, interiors: interiorMap };
}

/** Maps must be rectangular and use known tiles; everything placed in them must stand on floor. */
function validateInterior(inside: Interior, errors: string[]): void {
  const where = `interior "${inside.id}"`;
  const width = inside.map[0]?.length ?? 0;
  inside.map.forEach((row, y) => {
    if (row.length !== width) errors.push(`${where} row ${y} is ${row.length} wide, expected ${width}`);
    for (const ch of row) if (!(ch in TILE_SOLID)) errors.push(`${where} row ${y} uses unknown tile "${ch}"`);
  });
  const onFloor = (x: number, y: number, what: string): void => {
    if (!walkableTile(inside.map, x, y)) errors.push(`${where}: ${what} at ${x},${y} isn't on a floor tile`);
  };
  onFloor(inside.spawn.x, inside.spawn.y, 'spawn');
  onFloor(inside.exit.x, inside.exit.y, 'exit');
  const ids = new Set<string>();
  for (const sp of inside.spots) {
    if (ids.has(sp.id)) errors.push(`${where} has two spots called "${sp.id}"`);
    ids.add(sp.id);
  }
  for (const p of inside.people) onFloor(p.x, p.y, `person "${p.character}"`);
}

/** A condition may only name things that exist: characters, items, and flags something can set. */
function checkCondition(
  cond: Condition | undefined,
  where: string,
  refs: { characters: ReadonlyMap<string, Character>; items: ReadonlyMap<string, unknown>; flags: ReadonlySet<string> },
  errors: string[],
): void {
  if (!cond) return;
  const flags = [cond.flag, cond.notFlag, ...(cond.allFlags ?? []), ...(cond.anyFlag ?? []), ...(cond.noFlags ?? [])];
  for (const f of flags) if (f !== undefined && !refs.flags.has(f)) errors.push(`${where} checks flag "${f}", which nothing ever sets`);
  for (const who of [cond.crew, cond.notCrew, cond.minAffinity?.who, cond.romance]) {
    if (who !== undefined && !refs.characters.has(who)) errors.push(`${where} checks missing character "${who}"`);
  }
  if (cond.romance !== undefined && refs.characters.get(cond.romance)?.romance === null) errors.push(`${where} checks romance with "${cond.romance}", who isn't romanceable`);
  if (cond.hasItem !== undefined && !refs.items.has(cond.hasItem)) errors.push(`${where} checks missing item "${cond.hasItem}"`);
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
  appearance: appearanceJson,
  items: itemsJson,
  log: logJson,
  characters: charactersJson,
  pois: poisJson,
  missions: missionsJson,
  interiors: interiorsJson,
});
