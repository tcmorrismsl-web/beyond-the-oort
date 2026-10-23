import { describe, expect, it } from 'vitest';
import { buildGameData, gameData } from '../src/data/schema';
import { DEFAULT_LOOK, newGame, type Captain, type GameState } from '../src/core/state';
import { choose, conditionMet, dialoguesAt, fillText, shownChoices } from '../src/systems/dialogue';

const captainOf = (over: Partial<Captain> = {}): Captain => ({ name: 'Rhea Vance', pronouns: 'she', origin: 'frontier-colonist', moment: 'silent-colony', motive: 'the-signal', look: DEFAULT_LOOK, ...over });
const stateFor = (over: Partial<Captain> = {}): GameState => newGame(1, 1, { captain: captainOf(over), shipName: 'Lantern' });
const mara = gameData.dialogues.get('mara-departure-lounge');
if (!mara) throw new Error('mara missing');

describe('dialogue content', () => {
  it('is placed somewhere you can actually land', () => {
    expect(dialoguesAt('new-geneva', gameData.dialogues, stateFor()).map((d) => d.id)).toContain('mara-departure-lounge');
  });

  it('rejects broken conversations: missing links, unreachable nodes, dead ends, unknown backgrounds', () => {
    const ship = { id: 'a', name: 'A', hull: 1, shields: 0, thrust: 1, maxSpeed: 1, turnRate: 1, drag: 0, cargo: 0 };
    const base = { id: 'd', title: 'T', speaker: 'S', start: 'a' };
    const build = (nodes: unknown) => buildGameData({ ships: [ship], systems: [], dialogues: [{ ...base, nodes }] });
    expect(() => build({ a: { text: 't', choices: [{ text: 'go', to: 'nowhere' }] } })).toThrow(/missing node/);
    expect(() => build({ a: { text: 't', choices: [{ text: 'end', to: null }] }, b: { text: 't', choices: [{ text: 'end', to: null }] } })).toThrow(/never be reached/);
    expect(() => build({ a: { text: 't', choices: [{ text: 'x', to: null, if: { flag: 'f' } }] } })).toThrow(/strand the player/);
    expect(() => build({ a: { text: 't', choices: [{ text: 'x', to: null }, { text: 'y', to: null, if: { origin: ['martian-royalty'] } }] } })).toThrow(/unknown origin/);
  });
});

describe('dialogue engine', () => {
  it('fills in your name, ship and pronouns', () => {
    expect(fillText('{name} of the {ship}: {they} said {their} piece and we thanked {them}.', stateFor({ pronouns: 'he' }))).toBe(
      'Rhea Vance of the Lantern: he said his piece and we thanked him.',
    );
    expect(fillText('{they}/{them}/{their}', stateFor({ pronouns: 'they' }))).toBe('they/them/their');
  });

  it('shows background choices only to captains with that background, first in the list', () => {
    const frontier = shownChoices(mara, 'gossip', stateFor({ origin: 'frontier-colonist' }));
    expect(frontier[0]?.special).toBe(true);
    expect(frontier.map((c) => c.text).join(' ')).toContain('Frontier folk');
    expect(frontier.map((c) => c.text).join(' ')).not.toContain('freighter kid');
    const freighter = shownChoices(mara, 'gossip', stateFor({ origin: 'freighter-born' }));
    expect(freighter.map((c) => c.text).join(' ')).toContain('freighter kid');
  });

  it('a signal-chaser learns they are not alone, and the flag sticks', () => {
    let s = stateFor({ motive: 'the-signal' });
    const signal = shownChoices(mara, 'rumors', s).find((c) => c.text.includes('Static'));
    expect(signal).toBeDefined();
    const r = choose(mara, 'rumors', signal?.index ?? -1, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.flags).toContain('signal-not-alone');
    expect(r.next).toBe('signal');
  });

  it('refuses a choice your captain cannot see', () => {
    const s = stateFor({ origin: 'academy-legacy' });
    const hidden = mara.nodes['gossip']?.choices.findIndex((c) => c.if?.origin?.includes('freighter-born')) ?? -1;
    expect(choose(mara, 'gossip', hidden, s)).toEqual({ ok: false, reason: 'not-available' });
  });

  it('every captain can always finish the conversation (no dead ends, for any background)', () => {
    const c = gameData.creation;
    for (const o of c.origins) {
      for (const m of c.moments) {
        for (const mo of c.motives) {
          let s = stateFor({ origin: o.id, moment: m.id, motive: mo.id });
          let node: string | null = mara.start;
          for (let steps = 0; node !== null && steps < 20; steps += 1) {
            const options = shownChoices(mara, node, s);
            expect(options.length, `${o.id}/${m.id}/${mo.id} at ${node}`).toBeGreaterThan(0);
            // Take the last option: always the plain path forward.
            const pick = options[options.length - 1];
            const r = choose(mara, node, pick?.index ?? -1, s);
            if (!r.ok) throw new Error(`choice failed at ${node}`);
            s = r.state;
            node = r.next;
          }
          expect(node).toBeNull();
        }
      }
    }
  });

  it('conditions on flags and credits work', () => {
    const s = { ...stateFor(), flags: ['met-mara'], credits: 500 };
    expect(conditionMet({ flag: 'met-mara' }, s)).toBe(true);
    expect(conditionMet({ notFlag: 'met-mara' }, s)).toBe(false);
    expect(conditionMet({ minCredits: 600 }, s)).toBe(false);
  });
});

describe('the New Horizons signal', () => {
  const nh = gameData.dialogues.get('new-horizons-signal');
  if (!nh) throw new Error('new-horizons-signal missing');

  it('waits until you have landed once, then plays once', async () => {
    const { pendingTransmission } = await import('../src/systems/dialogue');
    const fresh = stateFor();
    expect(pendingTransmission(fresh, gameData.dialogues)).toBeNull();
    const landed = { ...fresh, flags: ['landed-once'] };
    expect(pendingTransmission(landed, gameData.dialogues)?.id).toBe('new-horizons-signal');
    const heard = { ...fresh, flags: ['landed-once', 'core-signal-heard', 'okafor-archive-lead'] };
    expect(pendingTransmission(heard, gameData.dialogues)).toBeNull();
    // Saves that heard it before Okafor pointed people to the Archive get a short follow-up call instead.
    const old = { ...fresh, flags: ['landed-once', 'core-signal-heard'] };
    expect(pendingTransmission(old, gameData.dialogues)?.id).toBe('okafor-archive-call');
    expect(pendingTransmission({ ...old, flags: [...old.flags, 'archive-lead'] }, gameData.dialogues)).toBeNull();
  });

  it('ends with the recording in your locker and the log entry unlocked, for every background', () => {
    for (const mo of gameData.creation.motives) {
      for (const m of gameData.creation.moments) {
        let s: GameState = { ...stateFor({ moment: m.id, motive: mo.id }), flags: ['landed-once'] };
        let node: string | null = nh.start;
        for (let i = 0; node !== null && i < 10; i += 1) {
          const opts = shownChoices(nh, node, s);
          const pick = opts[0]; // take the background-specific branch when there is one
          const r = choose(nh, node, pick?.index ?? -1, s);
          if (!r.ok) throw new Error(`stuck at ${node}`);
          s = r.state;
          node = r.next;
        }
        expect(node).toBeNull();
        expect(s.flags).toContain('core-signal-heard');
        expect(s.locker['nh-recording']).toBe(1);
        expect(gameData.log.some((e) => e.flag === 'core-signal-heard')).toBe(true);
      }
    }
  });

  it('names the stars in the order of the message', () => {
    const text = nh.nodes['message']?.text ?? '';
    const order = ['WOLF 359', "BARNARD'S STAR", 'ALPHA CENTAURI', 'SOL'].map((n) => text.indexOf(n));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > (order[i - 1] ?? -1)))).toBe(true);
    expect(text).toContain('WE ARE COMING FOR THE LOUD ONE');
  });

  it('Mara reacts to the broadcast once you have heard it', () => {
    const heard = { ...stateFor(), flags: ['core-signal-heard'] };
    expect(shownChoices(mara, 'rumors', heard).some((c) => c.text.includes('New Horizons'))).toBe(true);
    expect(shownChoices(mara, 'rumors', stateFor()).some((c) => c.text.includes('New Horizons'))).toBe(false);
  });
});
