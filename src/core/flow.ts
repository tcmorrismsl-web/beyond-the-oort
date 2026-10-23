/**
 * Game-flow state machine: which mode the player is in, and which moves
 * between modes are legal. Built now so space ↔ on-foot switching is part of
 * the architecture before on-foot gameplay exists.
 *
 *   flight ⇄ landed      fly to a planet/station and land, then launch
 *   landed ⇄ onFoot      leave the port menu to walk a station or your ship
 *   flight ⇄ onFoot      board a disabled ship, then return to your helm
 */
export type GameMode = 'flight' | 'landed' | 'onFoot';

const allowed: Readonly<Record<GameMode, readonly GameMode[]>> = {
  flight: ['landed', 'onFoot'],
  landed: ['flight', 'onFoot'],
  onFoot: ['landed', 'flight'],
};

export function canTransition(from: GameMode, to: GameMode): boolean {
  return allowed[from].includes(to);
}

export type TransitionResult = { ok: true; mode: GameMode } | { ok: false; reason: string };

export function transition(from: GameMode, to: GameMode): TransitionResult {
  if (from === to) return { ok: false, reason: `already in ${to}` };
  if (!canTransition(from, to)) return { ok: false, reason: `cannot go from ${from} to ${to}` };
  return { ok: true, mode: to };
}
