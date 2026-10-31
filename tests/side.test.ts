import { describe, expect, it } from 'vitest';
import { gameData, type Dialogue } from '../src/data/schema';
import { DEFAULT_LOOK, newGame, type Captain, type GameState, type Pronouns } from '../src/core/state';
import { Session } from '../src/core/session';
import { choose, dialogueAtPoi, dialoguesAt, shownChoices } from '../src/systems/dialogue';
import { boardLeads, journal, trackedObjective } from '../src/systems/missions';
import { dialogueAtSpot, entryOpen } from '../src/systems/onfoot';

const captainOf = (over: Partial<Captain> = {}): Captain => ({ name: 'Rhea Vance', pronouns: 'she', origin: 'frontier-colonist', moment: 'silent-colony', motive: 'the-signal', look: DEFAULT_LOOK, ...over });
const fresh = (over: Partial<Captain> = {}): GameState => newGame(1, 1, { captain: captainOf(over), shipName: 'Lantern' });
const at = (s: GameState, siteId: string): GameState => {
  const spot = gameData.sites.get(siteId);
  if (!spot) throw new Error(`site ${siteId} missing`);
  return { ...s, systemId: spot.systemId, landedAt: siteId, mode: 'landed' };
};
const inSpace = (s: GameState, systemId: string): GameState => ({ ...s, systemId, landedAt: null, mode: 'flight' });

/** A path a player could take through a conversation that ends with `flag` set (only choices this captain sees). */
function playTo(d: Dialogue, start: GameState, flag: string, avoid: (text: string) => boolean = () => false): GameState | null {
  const seen = new Set<string>();
  const walk = (node: string, s: GameState, depth: number): GameState | null => {
    const key = `${node}|${s.flags.join(',')}|${JSON.stringify(s.affinity)}`;
    if (depth > 40 || seen.has(key)) return null;
    seen.add(key);
    for (const c of shownChoices(d, node, s)) {
      if (avoid(c.text)) continue;
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
const site = (s: GameState, siteId: string, id: string): Dialogue => {
  const d = dialoguesAt(siteId, gameData.dialogues, at(s, siteId)).find((x) => x.id === id);
  if (!d) throw new Error(`${id} not available at ${siteId}`);
  return d;
};
const play = (d: Dialogue | null | undefined, s: GameState, flag: string, label: string): GameState => {
  expect(d, `${label}: nothing to play for ${flag}`).toBeTruthy();
  const next = d ? playTo(d, s, flag) : null;
  expect(next, `${label}: can't reach ${flag}${d ? ` in ${d.id}` : ''}`).not.toBeNull();
  return next ?? s;
};

const captains: Partial<Captain>[] = [];
for (const p of ['she', 'he', 'they'] as Pronouns[]) {
  captains.push({ pronouns: p });
  captains.push({ pronouns: p, origin: 'sol-undercity', moment: 'the-debt', motive: 'searching' });
  captains.push({ pronouns: p, origin: 'academy-legacy', moment: 'decorated-discharged', motive: 'make-a-name' });
}

describe('Jobs boards', () => {
  it('post every side story as a lead until you take it; taking it starts and tracks the mission', () => {
    const s = at(fresh(), 'new-geneva');
    const leads = boardLeads(s, gameData).map((l) => l.mission.id);
    for (const m of gameData.missions.filter((x) => x.board)) expect(leads, m.id).toContain(m.id);
    const session = Session.start(1, 1, { load: () => ({ status: 'empty' }), save: () => ({ ok: true }), backupCorrupt: () => ({ ok: true }) });
    session.state = s;
    expect(session.takeLead('the-echo', 2)).toBe(true);
    expect(journal(session.state, gameData).find((p) => p.mission.id === 'the-echo')?.done).toBe(false);
    expect(trackedObjective(session.state, gameData, session.tracked)?.mission.id).toBe('the-echo');
    expect(boardLeads(session.state, gameData).map((l) => l.mission.id)).not.toContain('the-echo');
    expect(session.takeLead('the-echo', 3)).toBe(false); // can't take it twice
  });

  it('leads are sorted nearest first', () => {
    const leads = boardLeads(at(fresh(), 'terminator-city'), gameData);
    for (let i = 1; i < leads.length; i += 1) expect(leads[i - 1]?.jumps ?? 0).toBeLessThanOrEqual(leads[i]?.jumps ?? 0);
    expect(leads[0]?.systemId).toBe('alpha-centauri');
  });
});

describe('side stories can be finished by every kind of captain', () => {
  for (const cap of captains) {
    const label = `${cap.pronouns}/${cap.origin ?? 'default'}`;
    it(label, () => {
      let s = fresh(cap);
      // The Echo: Lalande 21185, ending inside the consortium yard.
      s = play(site(s, 'survey-camp', 'brooks-echo'), at(s, 'survey-camp'), 'echo-briefed', label);
      s = inSpace(s, 'lalande-21185');
      const yard = gameData.pois.get('consortium-yard');
      expect(entryOpen(yard?.interior, s), label).toBe(true);
      s = play(dialogueAtSpot('consortium-yard', 'airlock', gameData.dialogues, s), s, 'yard-boarded', label);
      s = play(dialogueAtSpot('consortium-yard', 'office', gameData.dialogues, s), s, 'yard-sheet', label);
      s = play(dialogueAtSpot('consortium-yard', 'transmitter', gameData.dialogues, s), s, 'echo-source-found', label);
      s = play(site(s, 'survey-camp', 'brooks-echo-end'), at(s, 'survey-camp'), 'echo-done', label);
      // Sleepwalkers.
      s = play(site(s, 'darkside-camp', 'ferro-sleep'), at(s, 'darkside-camp'), 'sleep-briefed', label);
      s = play(site(s, 'darkside-camp', 'sleep-night'), at(s, 'darkside-camp'), 'sleep-done', label);
      // Europa.
      s = play(site(s, 'europa-deep', 'ness-europa'), at(s, 'europa-deep'), 'europa-done', label);
      // Vega.
      s = play(site(s, 'vega-depot-dock', 'vega-bulkhead'), at(s, 'vega-depot-dock'), 'vega-read', label);
      // The Terminator Run.
      s = play(site(s, 'terminator-city', 'juno-intro'), at(s, 'terminator-city'), 'juno-briefed', label);
      s = play(site(s, 'darkside-camp', 'kade-darkside'), at(s, 'darkside-camp'), 'juno-core', label);
      s = play(site(s, 'terminator-city', 'juno-return'), at(s, 'terminator-city'), 'juno-done', label);
      // Whispering Cargo.
      s = play(site(s, 'waystation-ring', 'dez-intro'), at(s, 'waystation-ring'), 'dez-briefed', label);
      s = inSpace(s, 'barnards-star');
      s = play(dialogueAtPoi('barnard-deep', gameData.dialogues, s), s, 'dez-crate-gone', label);
      s = play(site(s, 'waystation-ring', 'dez-return'), at(s, 'waystation-ring'), 'dez-done', label);
      // Letters from Pilgrim's Field.
      s = play(site(s, 'pilgrim-field', 'vesna-intro'), at(s, 'pilgrim-field'), 'vesna-briefed', label);
      s = play(site(s, 'verdance', 'mira-verdance'), at(s, 'verdance'), 'vesna-letter-delivered', label);
      s = play(site(s, 'pilgrim-field', 'vesna-return'), at(s, 'pilgrim-field'), 'vesna-done', label);

      const side = journal(s, gameData).filter((p) => p.mission.kind === 'side');
      expect(side.length, label).toBe(gameData.missions.filter((m) => m.kind === 'side').length);
      for (const p of side) expect(p.done, `${label}: ${p.mission.id}`).toBe(true);
      for (const item of ['consortium-buildsheet', 'sleepwalker-recording', 'europa-vial', 'bulkhead-rubbing', 'juno-pennant', 'vesna-wings']) expect(s.locker[item], `${label}: ${item}`).toBe(1);
      // Hand-offs leave the locker: no letters or crates left behind.
      for (const gone of ['vesna-letter', 'mira-reply', 'whispering-crate', 'juno-navcore']) expect(s.locker[gone], `${label}: ${gone}`).toBeUndefined();
    });
  }
});

describe('new romances', () => {
  const night = (who: string, dialogueId: string, siteId: string, flags: string[], pronouns: Pronouns, affinity: number): GameState | null => {
    const s = at({ ...fresh({ pronouns }), flags, affinity: { [who]: affinity } }, siteId);
    const d = dialoguesAt(siteId, gameData.dialogues, s).find((x) => x.id === dialogueId);
    return d ? playTo(d, s, `${who}-night`) : null;
  };

  it('Juno is open to any captain and can reach a fade to black', () => {
    for (const p of ['she', 'he', 'they'] as Pronouns[]) expect(night('juno', 'juno-regular', 'terminator-city', ['juno-done', 'juno-flirted'], p, 3), p).not.toBeNull();
  });

  it('Dez leans toward women; other captains can still win him over with more approval', () => {
    expect(night('dez', 'dez-regular', 'waystation-ring', ['dez-done', 'dez-flirted'], 'she', 2)).not.toBeNull();
    expect(night('dez', 'dez-regular', 'waystation-ring', ['dez-done', 'dez-flirted'], 'they', 2)).not.toBeNull();
    expect(night('dez', 'dez-regular', 'waystation-ring', ['dez-done', 'dez-flirted'], 'he', 2)).toBeNull();
    expect(night('dez', 'dez-regular', 'waystation-ring', ['dez-done', 'dez-flirted'], 'he', 5)).not.toBeNull();
  });

  it('Vesna is a slow burn: a first kiss in her story, more to come', () => {
    const s = at({ ...fresh({ pronouns: 'he' }), flags: ['vesna-briefed', 'vesna-letter-delivered'], locker: { 'mira-reply': 1 }, affinity: { vesna: 3 } }, 'pilgrim-field');
    const d = dialoguesAt('pilgrim-field', gameData.dialogues, s).find((x) => x.id === 'vesna-return');
    expect(d && playTo(d, s, 'vesna-kiss')).toBeTruthy();
  });
});
