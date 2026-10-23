/**
 * The live playthrough: one GameState plus the event bus, shared by every
 * scene. Scenes get the session from the game registry; they never keep
 * their own copies of game data.
 */
import { EventBus } from './events';
import { transition, type GameMode, type TransitionResult } from './flow';
import { backupCorruptSave, loadGame, saveGame, type LoadResult } from './save';
import { fromSave, isValidLook, newGame, repairAgainstContent, toSave, type GameState, type Look, type NewCareer } from './state';
import { gameData } from '../data/schema';
import { canJump, depart, jump, land, type JumpCheck } from '../systems/travel';
import { buy, sell, type TradeResult } from '../systems/market';
import { canRepaint, canUpgrade, repaint, upgrade, type RepaintCheck, type UpgradeCheck } from '../systems/ship';
import { choose, type ChooseResult } from '../systems/dialogue';
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
      case 'ok': {
        const state = fromSave(loaded.data);
        const fixed = repairAgainstContent(state);
        if (fixed.length > 0) console.warn('save adjusted to current content:', fixed.join('; '));
        return new Session(state, 'resumed', null, backend);
      }
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

  /** Throw away the current playthrough and start a new captain's career (saved immediately). */
  startCareer(seed: number, now: number, career: NewCareer): void {
    this.state = newGame(seed, now, career);
    this.save(now);
  }

  /** Buy trade goods at the current site's market. Saves. */
  buyGoods(commodityId: string, qty: number, now: number): TradeResult {
    const r = buy(this.state, commodityId, qty, gameData);
    if (r.ok) this.applyTrade(r.state, commodityId, qty, now);
    return r;
  }

  /** Sell trade goods at the current site's market. Saves. */
  sellGoods(commodityId: string, qty: number, now: number): TradeResult {
    const r = sell(this.state, commodityId, qty, gameData);
    if (r.ok) this.applyTrade(r.state, commodityId, -qty, now);
    return r;
  }

  private applyTrade(next: GameState, commodityId: string, qty: number, now: number): void {
    const delta = next.credits - this.state.credits;
    this.state = next;
    this.bus.emit('traded', { commodityId, qty, credits: delta });
    this.save(now);
  }

  /** Buy the next tier of an upgrade at a drydock. Saves. */
  upgradeShip(trackId: string, now: number): UpgradeCheck {
    const check = canUpgrade(this.state, trackId, gameData);
    if (!check.ok) return check;
    this.state = upgrade(this.state, trackId, gameData);
    this.bus.emit('upgraded', { trackId, tier: check.tier });
    this.save(now);
    return check;
  }

  /** Jump to a linked system (after the scene's charge-up). Saves on arrival. */
  jumpTo(toId: string, now: number): JumpCheck {
    const check = canJump(this.state, toId, gameData);
    if (!check.ok) return check;
    const from = this.state.systemId;
    this.state = jump(this.state, toId, gameData);
    this.bus.emit('jumped', { from, to: toId });
    this.save(now);
    return check;
  }

  /** Land at a site in this system and switch to the port. Saves. */
  landOn(siteId: string, now: number): boolean {
    if (this.state.mode !== 'flight') return false;
    let next: GameState;
    try {
      next = land(this.state, siteId, gameData);
    } catch {
      return false;
    }
    // Remember that you've landed somewhere (some story events wait for it).
    this.state = next.flags.includes('landed-once') ? next : { ...next, flags: [...next.flags, 'landed-once'] };
    this.setMode('landed');
    this.bus.emit('landed', { siteId });
    this.save(now);
    return true;
  }

  /**
   * Hop to another landing site on the same planet/station without going
   * back to space (e.g. from New Geneva to Lagos on Earth). Saves.
   */
  moveToSite(siteId: string, now: number): boolean {
    const here = this.state.landedAt === null ? undefined : gameData.sites.get(this.state.landedAt);
    const there = gameData.sites.get(siteId);
    if (!here || !there || here.body.id !== there.body.id || siteId === this.state.landedAt) return false;
    this.state = land(this.state, siteId, gameData);
    this.bus.emit('landed', { siteId });
    this.save(now);
    return true;
  }

  /** Leave the port and return to flight just outside the body. Saves. */
  departPort(now: number): boolean {
    const siteId = this.state.landedAt;
    if (siteId === null || this.state.mode !== 'landed') return false;
    // Lifting off also proves you've landed (covers saves that were already
    // sitting at a port before the 'landed-once' flag existed).
    const next = depart(this.state, gameData);
    this.state = next.flags.includes('landed-once') ? next : { ...next, flags: [...next.flags, 'landed-once'] };
    this.setMode('flight');
    this.bus.emit('departed', { siteId });
    this.save(now);
    return true;
  }

  /** Change the captain's look (free, any time). Saves. */
  setLook(look: Look, now: number): boolean {
    const cap = this.state.captain;
    if (!cap || !isValidLook(look)) return false;
    this.state = { ...this.state, captain: { ...cap, look: { ...look } } };
    this.save(now);
    return true;
  }

  /** Repaint the ship at a drydock. Saves. */
  repaintShip(paint: GameState['paint'], now: number): RepaintCheck {
    const check = canRepaint(this.state, paint, gameData);
    if (!check.ok) return check;
    this.state = repaint(this.state, paint, gameData);
    this.save(now);
    return check;
  }

  /** Pick a dialogue choice; applies its effects. Saves whenever the story moved (flags/credits/items). */
  talk(dialogueId: string, nodeId: string, choiceIndex: number, now: number): ChooseResult {
    const d = gameData.dialogues.get(dialogueId);
    if (!d) return { ok: false, reason: 'unknown-node' };
    const r = choose(d, nodeId, choiceIndex, this.state);
    if (!r.ok) return r;
    const changed = r.state !== this.state;
    this.state = r.state;
    if (changed) this.save(now);
    return r;
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
