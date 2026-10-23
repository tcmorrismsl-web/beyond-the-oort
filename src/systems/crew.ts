/**
 * Crew and relationships. Each character has their own approval of you,
 * moved by what *they* care about (there is no global morality meter).
 *
 * Romance rules (Tyler, 2026-10-23):
 *  - Each romanceable character has a lean: the captains they're usually
 *    drawn to, by pronouns. They/them captains always count as a match.
 *  - Outside their lean you can still win them over; it takes more approval
 *    (`pastLean` extra). Written in character as "I don't usually... but",
 *    never as talking someone out of who they are.
 */
import type { Character, GameData } from '../data/schema';
import type { GameState } from '../core/state';

/** Approval is kept in a band so a single scene can't make or break a relationship forever. */
export const AFFINITY_MIN = -10;
export const AFFINITY_MAX = 20;

export function affinityOf(state: GameState, who: string): number {
  return state.affinity[who] ?? 0;
}

/** True if the captain is someone this character is usually drawn to. */
export function withinLean(character: Character, state: GameState): boolean {
  const r = character.romance;
  if (!r) return false;
  const pronouns = state.captain?.pronouns ?? 'they';
  if (pronouns === 'they' || r.leans === 'any') return true;
  return r.leans.includes(pronouns);
}

/** Approval this character needs before romance opens up with this captain (null = never). */
export function romanceThreshold(character: Character, state: GameState): number | null {
  const r = character.romance;
  if (!r) return null;
  return withinLean(character, state) ? r.at : r.at + r.pastLean;
}

export function romanceOpen(character: Character | undefined, state: GameState): boolean {
  if (!character) return false;
  const need = romanceThreshold(character, state);
  return need !== null && affinityOf(state, character.id) >= need;
}

export function changeAffinity(state: GameState, who: string, by: number): GameState {
  const next = Math.max(AFFINITY_MIN, Math.min(AFFINITY_MAX, affinityOf(state, who) + by));
  return { ...state, affinity: { ...state.affinity, [who]: next } };
}

/** Bring someone aboard. Remembers they've joined (so they can be invited back later). */
export function joinCrew(state: GameState, who: string): GameState {
  const flag = `joined-${who}`;
  return {
    ...state,
    crew: state.crew.includes(who) ? state.crew : [...state.crew, who],
    flags: state.flags.includes(flag) ? state.flags : [...state.flags, flag],
  };
}

export function leaveCrew(state: GameState, who: string): GameState {
  return state.crew.includes(who) ? { ...state, crew: state.crew.filter((c) => c !== who) } : state;
}

/** People who've sailed with you, aren't aboard now, and wait at this site. */
export function waitingAt(siteId: string, state: GameState, data: GameData): Character[] {
  return [...data.characters.values()].filter((c) => c.home === siteId && !state.crew.includes(c.id) && state.flags.includes(`joined-${c.id}`));
}

/** A word for how someone feels about you (shown instead of a number). */
export function feelingWord(value: number): string {
  if (value <= -4) return 'Cold';
  if (value < 0) return 'Wary';
  if (value < 3) return 'Neutral';
  if (value < 6) return 'Warming up';
  if (value < 10) return 'Likes you';
  return 'Close';
}
