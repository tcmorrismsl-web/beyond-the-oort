import { describe, expect, it } from 'vitest';
import { gameData, type Dialogue } from '../src/data/schema';
import { DEFAULT_LOOK, newGame, type Captain, type GameState, type Pronouns } from '../src/core/state';
import { deserialize } from '../src/core/save';
import { Session } from '../src/core/session';
import { choose, conditionMet, crewTalks, dialogueAtPoi, dialoguesAt, pendingTransmission, shownChoices } from '../src/systems/dialogue';
import { romanceOpen, romanceThreshold, waitingAt, withinLean } from '../src/systems/crew';
import { journal, poiInRange, progressOf, routeTo, trackedObjective, visiblePois } from '../src/systems/missions';

const captainOf = (over: Partial<Captain> = {}): Captain => ({ name: 'Rhea Vance', pronouns: 'she', origin: 'frontier-colonist', moment: 'silent-colony', motive: 'the-signal', look: DEFAULT_LOOK, ...over });
const stateFor = (over: Partial<Captain> = {}): GameState => newGame(1, 1, { captain: captainOf(over), shipName: 'Lantern' });
const dialogue = (id: string): Dialogue => {
  const d = gameData.dialogues.get(id);
  if (!d) throw new Error(`dialogue ${id} missing`);
  return d;
};
const character = (id: string) => {
  const c = gameData.characters.get(id);
  if (!c) throw new Error(`character ${id} missing`);
  return c;
};

/**
 * Find a way through a conversation that ends with `flag` set, the way a
 * player could: only choices this captain can see. Returns the end state,
 * or null if no path exists (a soft-lock for this captain).
 */
function playTo(d: Dialogue, start: GameState, flag: string): GameState | null {
  const seen = new Set<string>();
  const walk = (node: string, s: GameState, depth: number): GameState | null => {
    const key = `${node}|${s.flags.join(',')}|${s.crew.join(',')}`;
    if (depth > 40 || seen.has(key)) return null;
    seen.add(key);
    for (const c of shownChoices(d, node, s)) {
      const r = choose(d, node, c.index, s);
      if (!r.ok) continue;
      if (r.next === null) {
        if (r.state.flags.includes(flag)) return r.state;
        continue;
      }
      const found = walk(r.next, r.state, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(d.start, start, 0);
}

const at = (s: GameState, siteId: string): GameState => {
  const spot = gameData.sites.get(siteId);
  if (!spot) throw new Error(`site ${siteId} missing`);
  return { ...s, systemId: spot.systemId, landedAt: siteId, mode: 'landed' };
};
const inSpace = (s: GameState, systemId: string, x = 0, y = 0): GameState => ({ ...s, systemId, landedAt: null, mode: 'flight', ship: { ...s.ship, x, y } });

describe('romance rules', () => {
  const ilse = character('ilse'); // leans toward men
  const celeste = character('celeste'); // open to anyone

  it('they/them captains are always within a character\'s lean', () => {
    expect(withinLean(ilse, stateFor({ pronouns: 'they' }))).toBe(true);
    expect(withinLean(ilse, stateFor({ pronouns: 'he' }))).toBe(true);
    expect(withinLean(ilse, stateFor({ pronouns: 'she' }))).toBe(false);
  });

  it('outside their lean you can still win someone over, it just takes more approval', () => {
    const he = stateFor({ pronouns: 'he' });
    const she = stateFor({ pronouns: 'she' });
    const r = ilse.romance;
    if (!r) throw new Error('ilse should be romanceable');
    expect(romanceThreshold(ilse, he)).toBe(r.at);
    expect(romanceThreshold(ilse, she)).toBe(r.at + r.pastLean);
    expect(romanceOpen(ilse, { ...she, affinity: { ilse: r.at } })).toBe(false);
    expect(romanceOpen(ilse, { ...she, affinity: { ilse: r.at + r.pastLean } })).toBe(true);
    expect(romanceThreshold(celeste, she)).toBe(romanceThreshold(celeste, he));
    expect(romanceOpen(character('moth'), { ...he, affinity: { moth: 99 } })).toBe(false); // not romanceable
  });

  it('romances are never exclusive: no romance choice is blocked by what you did with someone else', () => {
    // Flags each character's own conversations can set.
    const setBy = new Map<string, Set<string>>();
    for (const d of gameData.dialogues.values()) {
      const who = d.character ?? d.crew;
      if (!who) continue;
      const set = setBy.get(who) ?? new Set<string>();
      for (const n of Object.values(d.nodes)) for (const c of n.choices) for (const e of c.effects) if (e.setFlag) set.add(e.setFlag);
      setBy.set(who, set);
    }
    for (const d of gameData.dialogues.values()) {
      for (const [nodeId, n] of Object.entries(d.nodes)) {
        for (const c of n.choices) {
          const target = c.if?.romance;
          if (!target) continue;
          const blockers = [c.if?.notFlag, ...(c.if?.noFlags ?? []), ...(d.if?.notFlag ? [d.if.notFlag] : [])].filter((f): f is string => f !== undefined);
          for (const [who, flags] of setBy) {
            if (who === target) continue;
            for (const b of blockers) expect(flags.has(b), `${d.id}/${nodeId}: romance with ${target} is blocked by ${who}'s flag "${b}"`).toBe(false);
          }
        }
      }
    }
  });
});

describe('crew', () => {
  it('joining remembers them; dismissed crew wait at home and can be invited back', () => {
    const saves: unknown[] = [];
    const s = Session.start(1, 1, { load: () => ({ status: 'empty' }), save: (d) => (saves.push(d), { ok: true }), backupCorrupt: () => ({ ok: true }) });
    s.startCareer(7, 2, { captain: captainOf(), shipName: 'Lantern' });
    s.state = { ...s.state, crew: ['quin'], flags: ['joined-quin'] };
    expect(s.dismiss('quin', 3)).toBe(true);
    expect(s.state.crew).toEqual([]);
    s.state = at(s.state, 'new-geneva');
    expect(s.invite('quin', 4)).toBe(false); // he isn't waiting here
    s.state = at(s.state, 'wolf-point-dock');
    expect(waitingAt('wolf-point-dock', s.state, gameData).map((c) => c.id)).toEqual(['quin']);
    expect(s.invite('quin', 5)).toBe(true);
    expect(s.state.crew).toEqual(['quin']);
  });

  it('crew conversations are only offered while that person is aboard', () => {
    const s = { ...stateFor(), flags: ['joined-ilse'] };
    expect(crewTalks('ilse', gameData.dialogues, s)).toEqual([]);
    expect(crewTalks('ilse', gameData.dialogues, { ...s, crew: ['ilse'] }).length).toBeGreaterThan(0);
  });
});

describe('missions and routes', () => {
  it('finds the shortest jump route', () => {
    expect(routeTo('sol', 'sol', gameData)).toEqual(['sol']);
    expect(routeTo('wolf-359', 'barnards-star', gameData)).toEqual(['wolf-359', 'sol', 'barnards-star']);
    const far = routeTo('sol', '61-cygni', gameData);
    expect(far?.[0]).toBe('sol');
    expect(far?.[far.length - 1]).toBe('61-cygni');
  });

  it('mission progress is read from story flags', () => {
    const m = gameData.missions.find((x) => x.id === 'static');
    if (!m) throw new Error('static missing');
    expect(progressOf(m, stateFor())).toBeNull();
    expect(progressOf(m, { ...stateFor(), flags: ['archive-lead'] })).toMatchObject({ step: 0, done: false });
    expect(progressOf(m, { ...stateFor(), flags: ['archive-lead', 'ilse-hired', 'ninefold-recorder'] })).toMatchObject({ done: true });
  });

  it('points of interest show when their condition holds, and investigating needs you close', () => {
    const s = inSpace(stateFor(), 'wolf-359', 1650, -1250);
    expect(visiblePois('wolf-359', s, gameData).map((p) => p.id)).toContain('ninefold-wreck');
    expect(poiInRange(s, gameData)?.id).toBe('ninefold-wreck');
    expect(poiInRange({ ...s, ship: { ...s.ship, x: 0, y: 0 } }, gameData)).toBeNull();
    // Before the Archive hires you the wreck is sealed; afterwards you can board her.
    expect(dialogueAtPoi('ninefold-wreck', gameData.dialogues, s)?.id).toBe('ninefold-sealed');
    expect(dialogueAtPoi('ninefold-wreck', gameData.dialogues, { ...s, flags: ['ilse-hired'] })?.id).toBe('ninefold-wreck-search');
  });
});

/**
 * Plays Act 1 the way a player would, for every captain background and
 * pronoun: each story beat must be reachable with only the choices that
 * captain can see, and the journal must always point somewhere real.
 */
describe('Act 1 playthrough', () => {
  const pronouns: Pronouns[] = ['she', 'he', 'they'];
  const c = gameData.creation;
  const captains: Partial<Captain>[] = [];
  for (const o of c.origins) for (const m of c.moments) for (const mo of c.motives) for (const p of pronouns) captains.push({ origin: o.id, moment: m.id, motive: mo.id, pronouns: p });

  it(`every captain (${captains.length} combinations) can play from the signal to Tallis Camp`, () => {
    for (const cap of captains) {
      const label = `${cap.origin}/${cap.moment}/${cap.motive}/${cap.pronouns}`;
      let s: GameState = { ...stateFor(cap), flags: ['landed-once'] };
      const beats: [() => Dialogue | null | undefined, string][] = [
        [() => pendingTransmission(s, gameData.dialogues), 'okafor-archive-lead'],
        [() => dialoguesAt('archive-halls', gameData.dialogues, (s = at(s, 'archive-halls'))).find((d) => d.id === 'ilse-archive'), 'ilse-hired'],
        [() => dialogueAtPoi('ninefold-wreck', gameData.dialogues, (s = inSpace(s, 'wolf-359', 1650, -1250))), 'ninefold-recorder'],
        [() => dialoguesAt('tallis-camp', gameData.dialogues, (s = at(s, 'tallis-camp')))[0], 'camp-searched'],
      ];
      for (const [find, flag] of beats) {
        const obj = trackedObjective(s, gameData);
        if (obj?.target) expect(gameData.systems.has(obj.target.system), label).toBe(true);
        const d = find();
        expect(d, `${label}: nothing to play before "${flag}"`).toBeTruthy();
        if (!d) return;
        const next = playTo(d, s, flag);
        expect(next, `${label}: can't reach "${flag}" in ${d.id}`).not.toBeNull();
        if (!next) return;
        s = next;
      }
      expect(s.crew, label).toEqual(['ilse', 'quin']);
      expect(s.locker['ninefold-recorder'], label).toBe(1);
      const done = journal(s, gameData).filter((p) => p.done).map((p) => p.mission.id);
      expect(done, label).toEqual(expect.arrayContaining(['static', 'the-quiet-camp']));
    }
  });

  it('Mara and Celeste can both reach a fade to black in the same playthrough', () => {
    const marasNight = dialogue('mara-regular');
    let s = at({ ...stateFor({ pronouns: 'he' }), flags: ['met-mara', 'mara-interested', 'camp-searched'], affinity: { mara: 3 } }, 'new-geneva');
    expect(conditionMet(marasNight.if, s)).toBe(true);
    const after = playTo(marasNight, s, 'mara-night');
    expect(after).not.toBeNull();
    s = after ?? s;
    const fades = Object.values(marasNight.nodes).filter((n) => n.mood === 'fade');
    expect(fades.length).toBeGreaterThan(0);
    // Nothing Mara set blocks anyone else (see "never exclusive" above).
    expect(s.flags).toContain('mara-night');
  });
});

describe('saves', () => {
  it('a v6 save gets an empty crew and no approvals', () => {
    const v6 = {
      version: 6, createdAt: 1, updatedAt: 2, rngSeed: 5, credits: 900, systemId: 'sol', ship: { defId: 'prototype', x: 1, y: 2, angle: 0 },
      visited: ['sol'], landedAt: null, captain: null, shipName: 'Lantern', upgrades: {}, cargo: {}, locker: {}, flags: ['core-signal-heard'],
      paint: { hull: '#dfe8ff', accent: '#4fc3ff', pattern: 'plain', glow: '#ffa040' },
    };
    const r = deserialize(JSON.stringify(v6));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data.crew).toEqual([]);
    expect(r.data.affinity).toEqual({});
    expect(r.data.flags).toEqual(['core-signal-heard']);
  });
});
