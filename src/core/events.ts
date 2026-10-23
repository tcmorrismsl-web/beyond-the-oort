/**
 * Typed event bus for decoupled cross-system events. Systems and the session
 * announce what happened; scenes react (sound, particles, UI). Every event
 * name has a payload type, so a typo or a wrong payload is a compile error.
 *
 * Scenes must unsubscribe in their `shutdown` handler (use the function
 * returned by `on`), or a restarted scene will receive events twice.
 */
import type { GameMode } from './flow';

export interface GameEvents {
  modeChanged: { from: GameMode; to: GameMode };
  saved: { at: number };
  jumped: { from: string; to: string };
  landed: { siteId: string };
  departed: { siteId: string };
  saveFailed: { reason: string };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<EventName, Set<(payload: never) => void>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends EventName>(name: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler);
    return () => {
      this.handlers.get(name)?.delete(handler);
    };
  }

  emit<K extends EventName>(name: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    // Copy first: a handler may unsubscribe itself (or others) while we iterate.
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (err) {
        // One broken listener must not stop the others or crash the frame.
        console.error(`event handler for "${name}" threw`, err);
      }
    }
  }

  listenerCount(name: EventName): number {
    return this.handlers.get(name)?.size ?? 0;
  }
}
