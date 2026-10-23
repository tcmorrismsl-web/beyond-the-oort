/**
 * The live playthrough: one GameState plus the event bus, shared by every
 * scene. Scenes get the session from the game registry; they never keep
 * their own copies of game data.
 */
import { EventBus } from './events';
import { transition, type GameMode, type TransitionResult } from './flow';
import { backupCorruptSave, loadGame, saveGame, type LoadResult } from './save';
import { fromSave, newGame, toSave, type GameState } from './state';
import type { StorageResult } from './storage';

export interface SaveBackend {
  load: () => LoadResult;
  save: (data: ReturnType<typeof toSave>) => StorageResult;
  backupCorrupt: (now: number) => StorageResult;
}

const browserBackend: SaveBackend = { load: loadGame, save: saveGame, backupCorrupt: backupCorruptSave };

export type StartKind = 'new' | 'resumed' | 'recovered';

export class Session {
  readonly bus = new EventBus();

  private constructor(
    public state: GameState,
    readonly started: StartKind,
    readonly loadProblem: string | null,
    private readonly backend: SaveBackend,
  ) {}

  /**
   * Resume the saved game if there is one. A corrupt save is never lost
   * silently: it is copied aside first, then we start fresh and report it.
   */
  static start(seed: number, now: number, backend: SaveBackend = browserBackend): Session {
    const loaded = backend.load();
    switch (loaded.status) {
      case 'ok':
        return new Session(fromSave(loaded.data), 'resumed', null, backend);
      case 'empty':
        return new Session(newGame(seed, now), 'new', null, backend);
      case 'corrupt': {
        const backup = backend.backupCorrupt(now);
        const problem = backup.ok ? loaded.reason : `${loaded.reason} (backup failed: ${backup.reason})`;
        return new Session(newGame(seed, now), 'recovered', problem, backend);
      }
    }
  }

  save(now: number): StorageResult {
    let result: StorageResult;
    try {
      result = this.backend.save(toSave(this.state, now));
    } catch (err) {
      // e.g. validation rejecting a NaN position. Never write bad data and
      // never let a save attempt crash the game: report it instead.
      result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) this.bus.emit('saved', { at: now });
    else this.bus.emit('saveFailed', { reason: result.reason });
    return result;
  }

  setMode(to: GameMode): TransitionResult {
    const from = this.state.mode;
    const result = transition(from, to);
    if (result.ok) {
      this.state.mode = result.mode;
      this.bus.emit('modeChanged', { from, to: result.mode });
    }
    return result;
  }
}
