/**
 * Branching conversations. Pure functions over state + content data:
 * which choices you see depends on your background (origin, defining
 * moment, motive), pronouns, story flags and credits; choosing applies
 * effects (flags, credits, locker items) and moves to the next node.
 */
import type { Condition, Dialogue, Effect } from '../data/schema';
import type { GameState } from '../core/state';

export interface ShownChoice {
  index: number; // index into the node's full choice list
  text: string;
  /** True for choices unlocked by your background or story (shown highlighted). */
  special: boolean;
}

export function conditionMet(cond: Condition | undefined, state: GameState): boolean {
  if (!cond) return true;
  const cap = state.captain;
  if (cond.origin && !(cap && cond.origin.includes(cap.origin))) return false;
  if (cond.moment && !(cap && cond.moment.includes(cap.moment))) return false;
  if (cond.motive && !(cap && cond.motive.includes(cap.motive))) return false;
  if (cond.pronouns && !(cap && cond.pronouns.includes(cap.pronouns))) return false;
  if (cond.flag !== undefined && !state.flags.includes(cond.flag)) return false;
  if (cond.notFlag !== undefined && state.flags.includes(cond.notFlag)) return false;
  if (cond.minCredits !== undefined && state.credits < cond.minCredits) return false;
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

/** Choices you can see at this node, in order. Background/story choices come first. */
export function shownChoices(d: Dialogue, nodeId: string, state: GameState): ShownChoice[] {
  const node = d.nodes[nodeId];
  if (!node) return [];
  const shown: ShownChoice[] = [];
  node.choices.forEach((c, index) => {
    if (conditionMet(c.if, state)) shown.push({ index, text: fillText(c.text, state), special: c.if !== undefined });
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

/** Conversations available at a landing site. */
export function dialoguesAt(siteId: string, dialogues: ReadonlyMap<string, Dialogue>): Dialogue[] {
  return [...dialogues.values()].filter((d) => d.site === siteId);
}
