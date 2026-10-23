/**
 * Branching conversations. Pure functions over state + content data:
 * which choices you see depends on your background (origin, defining
 * moment, motive), pronouns, story flags and credits; choosing applies
 * effects (flags, credits, locker items) and moves to the next node.
 */
import { gameData, type Character, type Condition, type Dialogue, type Effect } from '../data/schema';
import type { GameState } from '../core/state';
import { affinityOf, changeAffinity, joinCrew, leaveCrew, romanceOpen } from './crew';

export interface ShownChoice {
  index: number; // index into the node's full choice list
  text: string;
  /** True for choices unlocked by your background or story (shown highlighted). */
  special: boolean;
  /** True for flirting (shown with a heart). */
  flirt: boolean;
}

export function conditionMet(cond: Condition | undefined, state: GameState, characters: ReadonlyMap<string, Character> = gameData.characters): boolean {
  if (!cond) return true;
  const cap = state.captain;
  if (cond.origin && !(cap && cond.origin.includes(cap.origin))) return false;
  if (cond.moment && !(cap && cond.moment.includes(cap.moment))) return false;
  if (cond.motive && !(cap && cond.motive.includes(cap.motive))) return false;
  if (cond.pronouns && !(cap && cond.pronouns.includes(cap.pronouns))) return false;
  if (cond.flag !== undefined && !state.flags.includes(cond.flag)) return false;
  if (cond.notFlag !== undefined && state.flags.includes(cond.notFlag)) return false;
  if (cond.allFlags && !cond.allFlags.every((f) => state.flags.includes(f))) return false;
  if (cond.anyFlag && !cond.anyFlag.some((f) => state.flags.includes(f))) return false;
  if (cond.noFlags?.some((f) => state.flags.includes(f))) return false;
  if (cond.minCredits !== undefined && state.credits < cond.minCredits) return false;
  if (cond.crew !== undefined && !state.crew.includes(cond.crew)) return false;
  if (cond.notCrew !== undefined && state.crew.includes(cond.notCrew)) return false;
  if (cond.minAffinity && affinityOf(state, cond.minAffinity.who) < cond.minAffinity.value) return false;
  if (cond.romance !== undefined && !romanceOpen(characters.get(cond.romance), state)) return false;
  if (cond.hasItem !== undefined && (state.locker[cond.hasItem] ?? 0) < 1) return false;
  return true;
}

const PRONOUN_WORDS = {
  she: { they: 'she', them: 'her', their: 'her' },
  he: { they: 'he', them: 'him', their: 'his' },
  they: { they: 'they', them: 'them', their: 'their' },
} as const;

/** Fill {name}, {ship}, {they}, {them}, {their} from the captain. */
export function fillText(text: string, state: GameState): string {
  const cap = state.captain;
  const words = PRONOUN_WORDS[cap?.pronouns ?? 'they'];
  return text
    .replaceAll('{name}', cap?.name ?? 'Captain')
    .replaceAll('{ship}', state.shipName)
    .replaceAll('{they}', words.they)
    .replaceAll('{them}', words.them)
    .replaceAll('{their}', words.their);
}

export function nodeText(d: Dialogue, nodeId: string, state: GameState): string {
  const node = d.nodes[nodeId];
  return node ? fillText(node.text, state) : '';
}

/**
 * A choice is highlighted when something about you unlocked it: your
 * background, a crew member, an item, a relationship or something you
 * learned. Choices that only hide once used (notFlag/noFlags) aren't.
 */
function isSpecial(cond: Condition | undefined): boolean {
  if (!cond) return false;
  return Object.keys(cond).some((k) => k !== 'notFlag' && k !== 'noFlags');
}

/** Choices you can see at this node, in order. Background/story choices come first. */
export function shownChoices(d: Dialogue, nodeId: string, state: GameState): ShownChoice[] {
  const node = d.nodes[nodeId];
  if (!node) return [];
  const shown: ShownChoice[] = [];
  node.choices.forEach((c, index) => {
    if (conditionMet(c.if, state)) shown.push({ index, text: fillText(c.text, state), special: isSpecial(c.if), flirt: c.flirt === true || c.if?.romance !== undefined });
  });
  return [...shown.filter((c) => c.special), ...shown.filter((c) => !c.special)];
}

export function applyEffects(state: GameState, effects: readonly Effect[]): GameState {
  let next: GameState = state;
  for (const e of effects) {
    if (e.setFlag !== undefined && !next.flags.includes(e.setFlag)) next = { ...next, flags: [...next.flags, e.setFlag] };
    if (e.clearFlag !== undefined) {
      const gone = e.clearFlag;
      next = { ...next, flags: next.flags.filter((f) => f !== gone) };
    }
    if (e.credits !== undefined) next = { ...next, credits: Math.max(0, next.credits + e.credits) };
    if (e.locker !== undefined) {
      const { item, qty } = e.locker;
      next = { ...next, locker: { ...next.locker, [item]: (next.locker[item] ?? 0) + qty } };
    }
    if (e.removeItem !== undefined) {
      const gone = e.removeItem;
      next = { ...next, locker: Object.fromEntries(Object.entries(next.locker).filter(([k]) => k !== gone)) };
    }
    if (e.affinity) next = changeAffinity(next, e.affinity.who, e.affinity.by);
    if (e.join !== undefined) next = joinCrew(next, e.join);
    if (e.leave !== undefined) next = leaveCrew(next, e.leave);
  }
  return next;
}

export type ChooseResult = { ok: true; state: GameState; next: string | null } | { ok: false; reason: 'unknown-node' | 'not-available' };

/** Pick a choice (by its index in the node's full list). Returns the new state and next node (null = conversation over). */
export function choose(d: Dialogue, nodeId: string, choiceIndex: number, state: GameState): ChooseResult {
  const node = d.nodes[nodeId];
  if (!node) return { ok: false, reason: 'unknown-node' };
  const c = node.choices[choiceIndex];
  if (!c || !conditionMet(c.if, state)) return { ok: false, reason: 'not-available' };
  return { ok: true, state: applyEffects(state, c.effects), next: c.to };
}

/** Conversations available at a landing site right now. */
export function dialoguesAt(siteId: string, dialogues: ReadonlyMap<string, Dialogue>, state: GameState): Dialogue[] {
  return [...dialogues.values()].filter((d) => d.site === siteId && conditionMet(d.if, state));
}

/** The conversation (if any) waiting at a point of interest in space. */
export function dialogueAtPoi(poiId: string, dialogues: ReadonlyMap<string, Dialogue>, state: GameState): Dialogue | null {
  for (const d of dialogues.values()) if (d.poi === poiId && conditionMet(d.if, state)) return d;
  return null;
}

/** Things a crew member wants to talk about aboard (first = most urgent: content order). */
export function crewTalks(who: string, dialogues: ReadonlyMap<string, Dialogue>, state: GameState): Dialogue[] {
  if (!state.crew.includes(who)) return [];
  return [...dialogues.values()].filter((d) => d.crew === who && conditionMet(d.if, state));
}

/** The story event (if any) that should play in flight right now: the first triggered dialogue whose condition is met. */
export function pendingTransmission(state: GameState, dialogues: ReadonlyMap<string, Dialogue>): Dialogue | null {
  for (const d of dialogues.values()) {
    if (d.trigger && conditionMet(d.trigger.if, state)) return d;
  }
  return null;
}
