/**
 * Missions, routes and points of interest. A mission's progress is read
 * from story flags (see MissionSchema), so the journal can never disagree
 * with what happened in conversations, and old saves need no migration when
 * missions are added.
 */
import type { GameData, Mission, Poi, Target } from '../data/schema';
import type { GameState } from '../core/state';
import { conditionMet } from './dialogue';

/** How close (world units) you must fly to a point of interest to investigate it. */
export const INVESTIGATE_RANGE = 170;

export interface MissionProgress {
  mission: Mission;
  /** Index of the current step; equals steps.length when complete. */
  step: number;
  done: boolean;
}

export function progressOf(mission: Mission, state: GameState): MissionProgress | null {
  if (!conditionMet(mission.startIf, state)) return null;
  // The current step is the first one not yet done (steps can complete out of order; the journal shows the earliest open one).
  let step = mission.steps.findIndex((s) => !conditionMet(s.doneIf, state));
  if (step === -1) step = mission.steps.length;
  return { mission, step, done: step === mission.steps.length };
}

const KIND_ORDER = { main: 0, companion: 1, side: 2 } as const;

/** Every mission you've started, active first (main story, then companions, then side), then finished ones. */
export function journal(state: GameState, data: GameData): MissionProgress[] {
  const all = data.missions.map((m) => progressOf(m, state)).filter((p): p is MissionProgress => p !== null);
  const active = all.filter((p) => !p.done).sort((a, b) => KIND_ORDER[a.mission.kind] - KIND_ORDER[b.mission.kind]);
  return [...active, ...all.filter((p) => p.done)];
}

export interface Objective {
  mission: Mission;
  text: string;
  target: Target | null;
}

/** What the HUD points you at: the current step of the most important active mission. */
export function trackedObjective(state: GameState, data: GameData): Objective | null {
  const top = journal(state, data).find((p) => !p.done);
  if (!top) return null;
  const step = top.mission.steps[top.step];
  if (!step) return null;
  return { mission: top.mission, text: step.text, target: step.target ?? null };
}

/** Shortest jump route between systems (inclusive), or null if unreachable. */
export function routeTo(from: string, to: string, data: GameData): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length > 0) {
    const here = queue.shift() ?? '';
    for (const next of data.systems.get(here)?.links ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, here);
      if (next === to) {
        const path = [to];
        let at = to;
        while (at !== from) {
          at = prev.get(at) ?? from;
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Points of interest showing in this system right now. */
export function visiblePois(systemId: string, state: GameState, data: GameData): Poi[] {
  return [...data.pois.values()].filter((p) => p.system === systemId && conditionMet(p.if, state));
}

/** The nearest visible point of interest within investigate range of the ship (in flight only). */
export function poiInRange(state: GameState, data: GameData): Poi | null {
  if (state.landedAt !== null) return null;
  let best: Poi | null = null;
  let bestD = INVESTIGATE_RANGE;
  for (const p of visiblePois(state.systemId, state, data)) {
    const d = Math.hypot(p.x - state.ship.x, p.y - state.ship.y);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Where in this system an objective points (a body for a site, or a point of interest), or null if it's elsewhere. */
export function targetPosition(target: Target, state: GameState, data: GameData): { x: number; y: number } | null {
  if (target.system !== state.systemId) return null;
  if (target.poi !== undefined) {
    const p = data.pois.get(target.poi);
    return p ? { x: p.x, y: p.y } : null;
  }
  if (target.site !== undefined) {
    const s = data.sites.get(target.site);
    return s ? { x: s.body.x, y: s.body.y } : null;
  }
  return null;
}
