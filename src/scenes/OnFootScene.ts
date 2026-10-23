import Phaser from 'phaser';
import { gameData, type Interior } from '../data/schema';
import type { Session } from '../core/session';
import { consumeSteps, STEP } from '../systems/flight';
import { autoSpotAt, dialogueAtSpot, peopleHere, stepWalker, TILE_PX, withinReach, type Reachable, type Walker } from '../systems/onfoot';
import { IDLE, readStick, type StickReading } from '../ui/joystick';
import { button, createLayer, el, type Layer } from '../ui/dom';
import { openSheet, renderDialogue } from '../ui/panels';
import { getSession } from './sessionAccess';
import { onScreenResize } from './resize';
import { ensureFlashlightTexture, ensureInteriorTexture, ensurePersonTexture } from './interiorTextures';

const STICK_RADIUS = 60;
/** Crew members who walk with you (Mass Effect squad style). */
const MAX_FOLLOWERS = 2;
/** How far behind (in breadcrumb samples) each follower walks. */
const FOLLOW_GAP = 14;
/** Flashlight overlay size relative to the screen's long side. */
const FLASHLIGHT_SCALE = 1.6;

export interface OnFootData {
  interior: string;
}

/**
 * Walking around a place on foot, top-down: a wreck, a camp, a station.
 * Same thumb controls as flight (floating stick). Walk up to things and tap
 * the action button to look at them or talk; the story plays as you find it.
 * Leaving returns you to wherever you came from (your ship, or the port).
 * Position inside is never saved: closing the app resumes outside.
 */
export class OnFootScene extends Phaser.Scene {
  private session!: Session;
  private inside!: Interior;
  private walker: Walker = { x: 0, y: 0, facing: 0 };
  private player!: Phaser.GameObjects.Image;
  private followers: Phaser.GameObjects.Image[] = [];
  private trail: { x: number; y: number }[] = [];
  private people: { spot: string; img: Phaser.GameObjects.Image }[] = [];
  private markers: Phaser.GameObjects.GameObject[] = [];
  private dark: Phaser.GameObjects.Image | null = null;
  private accumulator = 0;
  private stick: StickReading = IDLE;
  private stickPointerId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private ring!: Phaser.GameObjects.Image;
  private knob!: Phaser.GameObjects.Image;
  private ui!: Layer;
  private actionBtn!: HTMLButtonElement;
  private shownAction: Reachable | null = null;
  /** A conversation is open: the player stands still and controls are ignored. */
  private busy = false;
  private leaving = false;
  /** Auto spots already played this visit (never twice in one visit). */
  private autoPlayed = new Set<string>();

  constructor() {
    super('onfoot');
  }

  create(data: OnFootData): void {
    this.session = getSession(this);
    const inside = gameData.interiors.get(data.interior);
    if (!inside) {
      this.scene.start(this.session.state.landedAt === null ? 'flight' : 'landed');
      return;
    }
    this.inside = inside;
    this.walker = { x: inside.spawn.x, y: inside.spawn.y, facing: 0 };
    this.accumulator = 0;
    this.stick = IDLE;
    this.stickPointerId = null;
    this.shownAction = null;
    this.busy = false;
    this.leaving = false;
    this.autoPlayed = new Set();
    this.trail = [];
    this.followers = [];
    this.people = [];
    this.markers = [];
    this.dark = null;

    this.cameras.main.setBackgroundColor('#04060b');
    this.add.image(0, 0, ensureInteriorTexture(this, inside)).setOrigin(0).setDepth(0);
    this.buildMarkers();
    this.buildPeople();

    const cap = this.session.state.captain;
    const look = cap?.look ?? { face: 'oval', skin: '#c08559', hair: 'short', hairColor: '#3b2416', eyes: '#6b4a2b', outfit: 'flight-jacket', outfitColor: '#2b3a55', beard: 'none' };
    this.player = this.add.image(this.px(this.walker.x), this.px(this.walker.y), ensurePersonTexture(this, look)).setDepth(20);
    for (const id of this.session.state.crew.slice(0, MAX_FOLLOWERS)) {
      const who = gameData.characters.get(id);
      if (who) this.followers.push(this.add.image(this.player.x, this.player.y, ensurePersonTexture(this, who.look)).setDepth(19).setAlpha(0.95));
    }
    if (inside.dark) this.dark = this.add.image(0, 0, ensureFlashlightTexture(this)).setDepth(50);

    this.ring = this.add.image(0, 0, 'stick-ring').setScrollFactor(0).setDepth(60).setVisible(false);
    this.knob = this.add.image(0, 0, 'stick-knob').setScrollFactor(0).setDepth(61).setVisible(false);

    const cam = this.cameras.main;
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.centerOn(this.player.x, this.player.y);
    this.fit();
    onScreenResize(this, () => {
      this.fit();
    });
    cam.fadeIn(300, 0, 0, 0);
    this.buildHud();
    this.setupInput();
  }

  override update(_t: number, deltaMs: number): void {
    const cam = this.cameras.main;
    if (cam.width !== this.scale.width || cam.height !== this.scale.height) this.fit();
    const { steps, remainder } = consumeSteps(this.accumulator, deltaMs / 1000);
    this.accumulator = remainder;
    for (let i = 0; i < steps && !this.busy; i += 1) {
      this.walker = stepWalker(this.walker, this.stick.throttle, this.stick.angle, STEP, this.inside.map);
    }
    this.player.setPosition(this.px(this.walker.x), this.px(this.walker.y)).setRotation(this.walker.facing);
    this.updateFollowers();
    if (this.dark) this.dark.setPosition(this.player.x, this.player.y);
    if (this.busy || this.leaving) return;
    this.updateAction();
    const auto = autoSpotAt(this.inside, this.walker, this.session.state, gameData);
    if (auto !== null && !this.autoPlayed.has(auto)) {
      this.autoPlayed.add(auto);
      this.play(auto);
    }
  }

  /** Test hook (smoke tests): stand somewhere, in tiles. */
  teleport(x: number, y: number): void {
    this.walker = { ...this.walker, x, y };
  }

  private px(tiles: number): number {
    return tiles * TILE_PX;
  }

  // ------------------------------------------------------------------ world

  /** A soft pulse on each thing worth a look, so you can find them in the dark. */
  private buildMarkers(): void {
    for (const m of this.markers) {
      this.tweens.killTweensOf(m);
      m.destroy();
    }
    this.markers = [];
    const state = this.session.state;
    const peopleSpots = new Set(this.inside.people.map((p) => p.spot));
    for (const s of this.inside.spots) {
      // People don't need a marker: you can see them.
      if (s.auto || peopleSpots.has(s.id) || !dialogueAtSpot(this.inside.id, s.id, gameData.dialogues, state)) continue;
      const dot = this.add.circle(this.px(s.x), this.px(s.y), 5, 0xffe2a3, 0.9).setDepth(55);
      const halo = this.add.circle(this.px(s.x), this.px(s.y), 12).setStrokeStyle(2, 0xffe2a3, 0.6).setDepth(55);
      this.tweens.add({ targets: halo, scale: 1.8, alpha: 0, duration: 1400, repeat: -1 });
      this.markers.push(dot, halo);
    }
    const ex = this.inside.exit;
    const exit = this.add.rectangle(this.px(ex.x), this.px(ex.y), 26, 26).setStrokeStyle(2, 0x7ee08a, 0.8).setDepth(55);
    this.markers.push(exit);
  }

  private buildPeople(): void {
    for (const p of this.people) p.img.destroy();
    this.people = peopleHere(this.inside, this.session.state).flatMap((p) => {
      const who = gameData.characters.get(p.character);
      if (!who) return [];
      const img = this.add.image(this.px(p.x), this.px(p.y), ensurePersonTexture(this, who.look)).setDepth(18).setRotation(Math.PI);
      return [{ spot: p.spot, img }];
    });
  }

  /** Crew walk in your footsteps, a few paces apart. */
  private updateFollowers(): void {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - this.player.x, last.y - this.player.y) > 4) this.trail.push({ x: this.player.x, y: this.player.y });
    const keep = FOLLOW_GAP * (MAX_FOLLOWERS + 1);
    if (this.trail.length > keep) this.trail.splice(0, this.trail.length - keep);
    this.followers.forEach((f, i) => {
      const target = this.trail[Math.max(0, this.trail.length - 1 - FOLLOW_GAP * (i + 1))];
      if (!target) return;
      const dx = target.x - f.x;
      const dy = target.y - f.y;
      if (Math.hypot(dx, dy) > 1) f.setRotation(Math.atan2(dy, dx));
      f.setPosition(f.x + dx * 0.2, f.y + dy * 0.2);
    });
  }

  private fit(): void {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    if (this.dark) this.dark.setDisplaySize(Math.max(width, height) * FLASHLIGHT_SCALE, Math.max(width, height) * FLASHLIGHT_SCALE);
    this.resetStick();
  }

  // ------------------------------------------------------------------ HUD & actions

  private buildHud(): void {
    this.ui = createLayer('onfoot');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ui.destroy();
    });
    this.actionBtn = button('', () => {
      this.act();
    }, 'primary land-btn');
    this.actionBtn.style.display = 'none';
    const hint = el('div', 'objective onfoot-hint', 'Walk with the stick. Glowing marks are worth a look.');
    this.ui.root.append(el('div', 'hud-tl', el('div', 'chip', el('b', '', this.inside.name)), hint), el('div', 'hud-br hud-stack', this.actionBtn));
    this.time.delayedCall(6000, () => {
      hint.remove();
    });
  }

  private updateAction(): void {
    const near = withinReach(this.inside, this.walker, this.session.state, gameData)[0] ?? null;
    const same = near !== null && this.shownAction !== null && near.kind === this.shownAction.kind && near.id === this.shownAction.id;
    if (same || (near === null && this.shownAction === null)) return;
    this.shownAction = near;
    if (!near) {
      this.actionBtn.style.display = 'none';
      return;
    }
    this.actionBtn.textContent = near.kind === 'spot' ? `Look · ${near.label}` : near.kind === 'exit' ? `Leave · ${near.label}` : near.label;
    this.actionBtn.style.display = '';
  }

  private act(): void {
    const a = this.shownAction;
    if (!a || this.busy || this.leaving) return;
    if (a.kind === 'exit') {
      this.leave();
      return;
    }
    // Turn to face what you're looking at.
    this.walker = { ...this.walker, facing: Math.atan2(a.y - this.walker.y, a.x - this.walker.x) };
    this.play(a.id);
  }

  /** Play the conversation at a spot; the world updates afterward (new things to find, people who left). */
  private play(spotId: string): void {
    const d = dialogueAtSpot(this.inside.id, spotId, gameData.dialogues, this.session.state);
    if (!d) return;
    this.busy = true;
    this.resetStick();
    this.actionBtn.style.display = 'none';
    openSheet(this.ui.root, (card, close) => {
      renderDialogue(card, this.session, d.id, () => {
        close();
        this.busy = false;
        this.shownAction = null;
        this.buildMarkers();
        this.buildPeople();
      });
    });
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.actionBtn.style.display = 'none';
    const to = this.session.leaveInterior(Date.now());
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(to);
    });
  }

  // ------------------------------------------------------------------ input

  private resetStick(): void {
    this.stickPointerId = null;
    this.stick = IDLE;
    this.ring.setVisible(false);
    this.knob.setVisible(false);
  }

  private setupInput(): void {
    this.input.addPointer(1);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (this.busy || this.leaving || this.stickPointerId !== null) return;
      this.stickPointerId = p.id;
      this.stickOrigin = { x: p.x, y: p.y };
      this.ring.setPosition(p.x, p.y).setVisible(true);
      this.knob.setPosition(p.x, p.y).setVisible(true);
      this.stick = readStick(p.x, p.y, p.x, p.y, STICK_RADIUS);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (p.id !== this.stickPointerId) return;
      this.stick = readStick(this.stickOrigin.x, this.stickOrigin.y, p.x, p.y, STICK_RADIUS);
      const dx = p.x - this.stickOrigin.x;
      const dy = p.y - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      this.knob.setPosition(this.stickOrigin.x + dx * k, this.stickOrigin.y + dy * k);
    });
    const release = (p: Phaser.Input.Pointer): void => {
      if (p.id === this.stickPointerId) this.resetStick();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);
    const onBlur = (): void => {
      this.resetStick();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
    });
  }
}
