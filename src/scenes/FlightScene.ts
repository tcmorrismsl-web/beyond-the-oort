import Phaser from 'phaser';
import { gameData, type Body, type Poi, type StarSystem } from '../data/schema';
import type { Session } from '../core/session';
import { CRUISE_IDLE, consumeSteps, stepShip, STEP, updateCruise, type CruiseState, type FlightStats, type ShipKinematics } from '../systems/flight';
import { statsFor } from '../systems/ship';
import { canJump, jumpBlockText, JUMP_CHARGE_SECONDS, landingTarget } from '../systems/travel';
import { IDLE, readStick, type StickReading } from '../ui/joystick';
import { button, createLayer, credits, el, type Layer } from '../ui/dom';
import { showToast } from '../ui/toast';
import { crewHasNews, openSheet, renderDialogue } from '../ui/panels';
import { dialogueAtPoi, pendingTransmission } from '../systems/dialogue';
import { poiInRange, routeTo, targetPosition, trackedObjective, visiblePois } from '../systems/missions';
import { getSession } from './sessionAccess';
import { entryOpen } from '../systems/onfoot';
import type { OnFootData } from './OnFootScene';
import { onScreenResize, onSceneEvent } from './resize';
import { ensureBodyTexture, ensureStarTexture, hexToNumber } from './systemTextures';
import { SHIP_DISPLAY, shipTextureFor } from './shipTexture';

const STICK_RADIUS = 60;
/** How much the star layers move relative to the camera (parallax depth). */
const FAR_PARALLAX = 0.15;
const NEAR_PARALLAX = 0.4;
/** Distance from screen center at which the home arrow sits, as a fraction of the short side. */
const ARROW_RING = 0.42;
/** Autosave interval in simulated seconds (plus a save whenever the app is hidden). */
const AUTOSAVE_SECONDS = 30;
/** Camera zoom at full cruise: pull back so you can see where you're going. */
const CRUISE_ZOOM = 0.72;
/** Fraction of the way the zoom moves toward its target each frame-step. */
const ZOOM_EASE = 0.06;
/** Camera looks this many seconds ahead of the ship's motion... */
const LOOK_AHEAD_SECONDS = 0.3;
/** ...but never more than this fraction of the screen's short side. */
const LOOK_AHEAD_MAX = 0.25;
const LOOK_AHEAD_EASE = 0.08;
const FLAME_CRUISE = { r: 0x8f, g: 0xd8, b: 0xff };
/** Tint for each kind of point of interest. */
const POI_TINT: Record<Poi['kind'], number> = { derelict: 0xc9ccd2, beacon: 0xb38cff, signal: 0x8fd8ff, anomaly: 0xff9f7a };

/** Data passed when the star chart closes and wakes flight. */
export interface FlightResumeData {
  jumpTo?: string;
}

/**
 * In-system flight. Two cameras: the main camera follows the ship and zooms
 * with speed; a HUD camera on top never zooms, so the joystick and arrow
 * stay exactly under the thumb. Every new object must be added via `world()`
 * or `hud()`, or it will render on both cameras. Buttons and labels are DOM
 * (see ui/dom.ts), destroyed on shutdown.
 */
export class FlightScene extends Phaser.Scene {
  private session!: Session;
  private def!: FlightStats;
  private system!: StarSystem;
  private ship!: Phaser.GameObjects.Image;
  private flame!: Phaser.GameObjects.Image;
  private accumulator = 0;
  private sinceSave = 0;
  private cruise: CruiseState = CRUISE_IDLE;
  private stick: StickReading = IDLE;
  private stickPointerId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private ring!: Phaser.GameObjects.Image;
  private knob!: Phaser.GameObjects.Image;
  private farStars!: Phaser.GameObjects.TileSprite;
  private nearStars!: Phaser.GameObjects.TileSprite;
  private star!: Phaser.GameObjects.Image;
  private homeArrow!: Phaser.GameObjects.Image;
  /** Edge arrows toward every body you can land on, so new systems aren't empty space. */
  private portArrows: { body: Body; arrow: Phaser.GameObjects.Image }[] = [];
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  /** Points of interest showing in this system (rebuilt when the story changes what's visible). */
  private poiViews: { poi: Poi; parts: Phaser.GameObjects.GameObject[]; arrow: Phaser.GameObjects.Image }[] = [];
  private objectiveArrow!: Phaser.GameObjects.Image;
  /** Where the tracked objective is in this system (null if elsewhere or none). */
  private objectivePos: { x: number; y: number } | null = null;
  private objectiveLine!: HTMLDivElement;
  /** The point of interest the objective points at (its own arrow is hidden in favor of the objective arrow). */
  private objectivePoi: string | null = null;
  private shipBtn!: HTMLButtonElement;
  private investigateBtn!: HTMLButtonElement;
  /** One-tap "next jump" toward the objective when it's in another system (no trip to the map needed). */
  private routeBtn!: HTMLButtonElement;
  private routeNext: string | null = null;
  private shownPoi: Poi | null = null;

  // DOM HUD
  private ui!: Layer;
  private landBtn!: HTMLButtonElement;
  private chargeBox!: HTMLDivElement;
  private chargeFill!: HTMLDivElement;
  private shownTarget: Body | null = null;

  // Jump charge in progress (null when not jumping)
  private jumpTarget: string | null = null;
  private jumpCharge = 0;
  /** Site picker open: the ship holds still and controls are ignored. */
  private picking = false;
  private creditsChip!: HTMLSpanElement;
  /** Engine glow color from your paint job; cruise blends toward blue-white. */
  private flameNormal = { r: 0xff, g: 0xa0, b: 0x40 };

  constructor() {
    super('flight');
  }

  create(): void {
    this.session = getSession(this);
    const state = this.session.state;
    const ship = state.ship;
    const system = gameData.systems.get(state.systemId);
    if (!system) throw new Error(`system "${state.systemId}" missing from data`);
    // Stock stats plus every upgrade you've bought.
    this.def = statsFor(state, gameData);
    this.system = system;

    // Reset per-run fields: Phaser reuses the scene instance on restart.
    this.accumulator = 0;
    this.sinceSave = 0;
    this.cruise = CRUISE_IDLE;
    this.stick = IDLE;
    this.stickPointerId = null;
    this.jumpTarget = null;
    this.jumpCharge = 0;
    this.shownTarget = null;
    this.picking = false;

    const { width, height } = this.scale;
    this.hudCam = this.cameras.add(0, 0, width, height).setName('hud');

    // Star layers live in the world camera (so they sit behind the ship) but
    // ignore scrolling and counter the zoom, so they always fill the screen.
    this.farStars = this.world(this.add.tileSprite(width / 2, height / 2, width, height, 'stars-far').setScrollFactor(0).setDepth(-20));
    this.nearStars = this.world(this.add.tileSprite(width / 2, height / 2, width, height, 'stars-near').setScrollFactor(0).setDepth(-19));
    this.star = this.world(this.add.image(0, 0, ensureStarTexture(this, system)).setDepth(-10));
    for (const body of system.bodies) {
      this.world(this.add.image(body.x, body.y, ensureBodyTexture(this, body)).setDepth(-5));
    }
    this.flame = this.world(this.add.image(ship.x, ship.y, 'flame').setOrigin(0, 0.5).setVisible(false).setDepth(-1));
    // Your paint job: built from the same art as the menus (placeholder for a moment if new).
    const shipKey = shipTextureFor(this, state.paint, (key) => {
      if (this.ship.active) this.ship.setTexture(key).setDisplaySize(SHIP_DISPLAY.width, SHIP_DISPLAY.height);
    });
    this.ship = this.world(this.add.image(ship.x, ship.y, shipKey).setRotation(ship.angle));
    if (shipKey !== 'ship') this.ship.setDisplaySize(SHIP_DISPLAY.width, SHIP_DISPLAY.height);
    const glow = hexToNumber(state.paint.glow);
    this.flameNormal = { r: (glow >> 16) & 255, g: (glow >> 8) & 255, b: glow & 255 };

    this.homeArrow = this.hud(this.add.image(0, 0, 'home-arrow').setDepth(5).setVisible(false));
    this.portArrows = system.bodies
      .filter((b) => b.sites.length > 0)
      .map((body) => ({
        body,
        arrow: this.hud(this.add.image(0, 0, 'port-arrow').setTint(hexToNumber(body.color)).setAlpha(0.9).setDepth(5).setVisible(false)),
      }));
    this.objectiveArrow = this.hud(this.add.image(0, 0, 'objective-arrow').setDepth(6).setVisible(false));
    this.poiViews = [];
    this.shownPoi = null;
    this.ring = this.hud(this.add.image(0, 0, 'stick-ring').setVisible(false).setDepth(10));
    this.knob = this.hud(this.add.image(0, 0, 'stick-knob').setVisible(false).setDepth(11));

    const cam = this.cameras.main;
    cam.setZoom(1);
    cam.startFollow(this.ship, true, 0.12, 0.12);
    cam.setFollowOffset(0, 0);
    cam.centerOn(ship.x, ship.y);
    cam.fadeIn(250, 5, 6, 10);
    onScreenResize(this, () => {
      this.fitToScreen();
    });
    this.setupInput();
    this.buildHud();
    this.refreshStory();
    this.refreshHud();
    this.checkTransmission();

    // The star chart puts flight to sleep (no update, no rendering) and wakes
    // it with `{ jumpTo }` if the player chose a jump.
    onSceneEvent(this, Phaser.Scenes.Events.WAKE, (_sys: unknown, data: unknown) => {
      this.ui.root.style.display = '';
      this.accumulator = 0;
      this.resetStick();
      this.refreshStory();
      this.refreshHud();
      const jumpTo = (data as FlightResumeData | undefined)?.jumpTo;
      if (jumpTo !== undefined) this.beginJump(jumpTo);
      // A talk aboard (Ship screen) can move the story on and set off a call.
      else this.checkTransmission();
    });
  }

  override update(_time: number, deltaMs: number): void {
    const cam = this.cameras.main;
    const ship = this.session.state.ship;
    const { steps, remainder } = consumeSteps(this.accumulator, deltaMs / 1000);
    this.accumulator = remainder;
    let kin: ShipKinematics = ship;
    for (let i = 0; i < steps && !this.picking; i += 1) {
      this.cruise = updateCruise(this.cruise, this.stick.throttle, STEP);
      kin = stepShip(kin, this.def, { throttle: this.stick.throttle, targetAngle: this.stick.angle, cruise: this.cruise.level }, STEP);
      cam.setZoom(cam.zoom + (1 - (1 - CRUISE_ZOOM) * this.cruise.level - cam.zoom) * ZOOM_EASE);
      this.easeLookAhead(cam, kin);
      if (this.jumpTarget !== null) this.jumpCharge += STEP;
    }
    Object.assign(ship, kin);
    // Safety net: if a resize was missed, the cameras no longer match the
    // screen (the ship drifts off-center or vanishes). Repair it here.
    if (cam.width !== this.scale.width || cam.height !== this.scale.height || this.hudCam.width !== this.scale.width) {
      this.fitToScreen();
    }
    this.ship.setPosition(ship.x, ship.y).setRotation(ship.angle);
    this.updateFlame();
    this.updateBackdrop();
    this.updateLandingButton();
    this.updateInvestigateButton();
    this.updateJumpCharge();

    this.sinceSave += steps * STEP;
    if (this.sinceSave >= AUTOSAVE_SECONDS) {
      this.sinceSave = 0;
      this.session.save(Date.now());
    }
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    this.ui = createLayer('flight');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ui.destroy();
    });
    const state = this.session.state;

    this.creditsChip = el('span', 'dim', `  ·  ${credits(state.credits)}`);
    this.objectiveLine = el('div', 'objective');
    const info = el('div', 'hud-tl', el('div', 'chip', el('b', '', this.system.name), this.creditsChip), this.objectiveLine);
    this.shipBtn = button('Ship', () => {
      this.openOverlay('ship');
    });
    const mapBtn = button('Map', () => {
      this.openOverlay('map');
    });
    const tr = el('div', 'hud-tr', this.shipBtn, mapBtn);

    this.landBtn = button('Land', () => {
      this.tryLand();
    }, 'primary land-btn');
    this.landBtn.style.display = 'none';
    this.investigateBtn = button('Investigate', () => {
      this.investigate();
    }, 'primary land-btn');
    this.investigateBtn.style.display = 'none';
    this.routeBtn = button('Next jump', () => {
      if (this.routeNext !== null && this.jumpTarget === null && !this.picking) this.beginJump(this.routeNext);
    }, 'route-btn');
    this.routeBtn.style.display = 'none';
    const br = el('div', 'hud-br hud-stack', this.routeBtn, this.investigateBtn, this.landBtn);

    this.chargeFill = el('div');
    this.chargeBox = el('div', 'center-msg', el('div', '', ''), el('div', 'bar', this.chargeFill));
    this.chargeBox.style.display = 'none';

    this.ui.root.append(info, tr, br, this.chargeBox);
  }

  /**
   * Story events that arrive in flight (e.g. the New Horizons signal): a
   * moment after you're back in space, the ship stops and the transmission
   * plays. It only counts as heard once you reach the end, so closing the app
   * mid-way just plays it again next time.
   */
  private checkTransmission(): void {
    const d = pendingTransmission(this.session.state, gameData.dialogues);
    if (!d) return;
    this.time.delayedCall(1100, () => {
      if (this.jumpTarget !== null || this.picking) return;
      this.picking = true;
      this.resetStick();
      const ship = this.session.state.ship;
      ship.vx = 0;
      ship.vy = 0;
      // Calls arrive with a jolt and a red light; scenes aboard just begin.
      if (d.aboard !== true) {
        showToast(d.title);
        this.cameras.main.shake(400, 0.004);
      }
      openSheet(this.ui.root, (card, close) => {
        if (d.aboard !== true) card.classList.add('transmission');
        renderDialogue(card, this.session, d.id, () => {
          close();
          this.picking = false;
          this.afterConversation();
        });
      });
    });
  }

  /** After any conversation in flight: the story may have moved (new objective, new things in space, another call). */
  private afterConversation(): void {
    this.refreshStory();
    this.refreshHud();
    this.checkTransmission();
  }

  private refreshHud(): void {
    this.creditsChip.textContent = `  ·  ${credits(this.session.state.credits)}`;
    this.shipBtn.classList.toggle('dot', crewHasNews(this.session.state));
  }

  /** Objective line + arrow target, and which points of interest are showing. */
  private refreshStory(): void {
    const state = this.session.state;
    const obj = trackedObjective(state, gameData);
    this.objectivePos = obj?.target ? targetPosition(obj.target, state, gameData) : null;
    const text = obj?.text ?? '';
    let where = '';
    this.routeNext = null;
    if (obj?.target && obj.target.system !== state.systemId) {
      const route = routeTo(state.systemId, obj.target.system, gameData);
      const next = route?.[1];
      const dest = gameData.systems.get(obj.target.system)?.name ?? obj.target.system;
      if (route && next !== undefined) {
        const hop = gameData.systems.get(next)?.name ?? next;
        where = route.length > 2 ? `${dest} · next jump: ${hop} (${route.length - 1} jumps)` : `Jump to ${dest}`;
        this.routeNext = next;
        this.routeBtn.textContent = route.length > 2 ? `Jump · ${hop} (${route.length - 1} to go)` : `Jump · ${dest}`;
      }
    }
    this.objectiveLine.replaceChildren(el('div', '', text), ...(where ? [el('div', 'objective-where', where)] : []));
    this.objectiveLine.style.display = text ? '' : 'none';
    this.routeBtn.style.display = this.routeNext === null ? 'none' : '';
    this.objectivePoi = obj?.target?.system === state.systemId ? (obj.target.poi ?? null) : null;
    this.buildPois();
  }

  /** (Re)draw the points of interest that are visible right now, each with an edge arrow. */
  private buildPois(): void {
    for (const v of this.poiViews) {
      this.tweens.killTweensOf(v.parts);
      for (const part of v.parts) part.destroy();
      v.arrow.destroy();
    }
    this.poiViews = visiblePois(this.system.id, this.session.state, gameData).map((poi) => {
      const tint = POI_TINT[poi.kind];
      const img = this.world(this.add.image(poi.x, poi.y, `poi-${poi.kind}`).setTint(tint).setDepth(-4));
      const halo = this.world(this.add.circle(poi.x, poi.y, 34).setStrokeStyle(2, tint, 0.6).setDepth(-4));
      this.tweens.add({ targets: halo, scale: 1.6, alpha: 0, duration: 1600, repeat: -1 });
      const label = this.world(
        this.add
          .text(poi.x, poi.y + 34, poi.name, { fontFamily: '-apple-system, system-ui, sans-serif', fontSize: '14px', color: '#e4ecff' })
          .setOrigin(0.5, 0)
          .setResolution(Math.min(3, window.devicePixelRatio || 1))
          .setDepth(-4),
      );
      const arrow = this.hud(this.add.image(0, 0, 'port-arrow').setTint(tint).setDepth(5).setVisible(false));
      return { poi, parts: [img, halo, label], arrow };
    });
    this.shownPoi = null;
  }

  private updateInvestigateButton(): void {
    const poi = this.jumpTarget === null ? poiInRange(this.session.state, gameData) : null;
    if (poi === this.shownPoi) return;
    this.shownPoi = poi;
    if (poi) {
      this.investigateBtn.textContent = entryOpen(poi.interior, this.session.state) ? `${poi.interior.label} · ${poi.name}` : `Investigate · ${poi.name}`;
      this.investigateBtn.style.display = '';
    } else {
      this.investigateBtn.style.display = 'none';
    }
  }

  /** Fly close to a wreck, beacon or reading point and look around (a conversation with the place). */
  private investigate(): void {
    const poi = this.shownPoi;
    if (!poi || this.jumpTarget !== null || this.picking) return;
    // Somewhere you can board and walk around? Step aboard.
    if (entryOpen(poi.interior, this.session.state) && this.session.enterInterior()) {
      const entry = poi.interior;
      this.picking = true;
      this.resetStick();
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('onfoot', { interior: entry.id } satisfies OnFootData);
      });
      return;
    }
    const d = dialogueAtPoi(poi.id, gameData.dialogues, this.session.state);
    this.picking = true;
    this.resetStick();
    const ship = this.session.state.ship;
    ship.vx = 0;
    ship.vy = 0;
    openSheet(this.ui.root, (card, close) => {
      if (!d) {
        card.append(el('h1', '', poi.name), el('p', 'dialogue-text', poi.description));
        const ok = button('Move on', () => {
          close();
          this.picking = false;
        }, 'pick');
        card.append(ok);
        return;
      }
      renderDialogue(card, this.session, d.id, () => {
        close();
        this.picking = false;
        this.afterConversation();
      });
    });
  }

  private updateLandingButton(): void {
    const target = this.jumpTarget === null ? landingTarget(this.session.state, gameData) : null;
    if (target === this.shownTarget) return; // only touch the DOM when it changes
    this.shownTarget = target;
    if (target) {
      this.landBtn.textContent = target.sites.length > 1 ? `Land · ${target.name} (${target.sites.length} sites)` : `Land · ${target.name}`;
      this.landBtn.style.display = '';
    } else {
      this.landBtn.style.display = 'none';
    }
  }

  private tryLand(): void {
    const target = this.shownTarget;
    if (!target || this.jumpTarget !== null || this.picking) return;
    const only = target.sites.length === 1 ? target.sites[0] : undefined;
    if (only) {
      this.landAt(only.id);
      return;
    }
    this.openSitePicker(target);
  }

  /** Planets with several landing sites: pick one (Starfield-style). */
  private openSitePicker(body: Body): void {
    this.picking = true;
    this.resetStick();
    const ship = this.session.state.ship;
    ship.vx = 0;
    ship.vy = 0;
    const card = el('div', 'card', el('h1', '', body.name), el('div', 'sub', 'Choose where to land'));
    for (const site of body.sites) {
      const b = button(site.name, () => {
        sheet.remove();
        this.landAt(site.id);
      }, 'pick');
      b.append(el('small', '', site.description));
      card.append(b);
    }
    const cancel = button('Stay in orbit', () => {
      sheet.remove();
      this.picking = false;
    });
    cancel.style.width = '100%';
    cancel.style.marginTop = '12px';
    card.append(cancel);
    const sheet = el('div', 'sheet', card);
    this.ui.root.append(sheet);
  }

  private landAt(siteId: string): void {
    if (this.session.landOn(siteId, Date.now())) {
      this.picking = true; // freeze until the scene changes
      this.cameras.main.fadeOut(200, 5, 6, 10);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('landed');
      });
    } else {
      this.picking = false;
    }
  }

  /** Star chart or ship screen: flight sleeps underneath and wakes when it closes. */
  private openOverlay(key: 'map' | 'ship'): void {
    if (this.jumpTarget !== null || this.picking) return;
    this.resetStick();
    this.ui.root.style.display = 'none';
    this.scene.sleep();
    this.scene.launch(key);
  }

  // ------------------------------------------------------------------ jumping

  private beginJump(toId: string): void {
    const check = canJump(this.session.state, toId, gameData);
    const label = this.chargeBox.firstElementChild;
    if (!check.ok) {
      showToast(jumpBlockText(check.reason));
      return;
    }
    const dest = gameData.systems.get(toId);
    this.jumpTarget = toId;
    this.jumpCharge = 0;
    if (label) label.textContent = `Jumping to ${dest?.name ?? toId}…`;
    this.chargeBox.style.display = '';
  }

  private updateJumpCharge(): void {
    if (this.jumpTarget === null) return;
    const t = Math.min(1, this.jumpCharge / JUMP_CHARGE_SECONDS);
    this.chargeFill.style.width = `${Math.round(t * 100)}%`;
    if (t < 1) return;
    const to = this.jumpTarget;
    this.jumpTarget = null;
    this.chargeBox.style.display = 'none';
    const result = this.session.jumpTo(to, Date.now());
    if (!result.ok) {
      showToast(jumpBlockText(result.reason));
      return;
    }
    this.cameras.main.flash(300, 220, 235, 255);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FLASH_COMPLETE, () => {
      this.scene.restart();
    });
  }

  // ------------------------------------------------------------------ camera & visuals

  /**
   * Lead the camera in the direction of travel so that at speed you see what
   * you're flying into, not what you left behind. (Phaser subtracts the
   * follow offset, hence the negative sign.)
   */
  private easeLookAhead(cam: Phaser.Cameras.Scene2D.Camera, kin: ShipKinematics): void {
    let ax = kin.vx * LOOK_AHEAD_SECONDS;
    let ay = kin.vy * LOOK_AHEAD_SECONDS;
    const max = (Math.min(cam.width, cam.height) * LOOK_AHEAD_MAX) / cam.zoom;
    const len = Math.hypot(ax, ay);
    if (len > max) {
      ax *= max / len;
      ay *= max / len;
    }
    const off = cam.followOffset;
    cam.setFollowOffset(off.x + (-ax - off.x) * LOOK_AHEAD_EASE, off.y + (-ay - off.y) * LOOK_AHEAD_EASE);
  }

  private world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.hudCam.ignore(obj);
    return obj;
  }

  private hud<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.cameras.main.ignore(obj);
    return obj;
  }

  /** Match both cameras and the star layers to the current game size and re-center. */
  private fitToScreen(): void {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.cameras.main.centerOn(this.ship.x, this.ship.y);
    this.farStars.setSize(width, height);
    this.nearStars.setSize(width, height);
    this.resetStick();
  }

  private updateFlame(): void {
    const throttle = this.stick.throttle;
    const level = this.cruise.level;
    const visible = throttle > 0.02 || level > 0.02;
    this.flame.setVisible(visible);
    if (!visible) return;
    const back = this.ship.rotation + Math.PI;
    const rear = this.ship.displayWidth / 2 - 2;
    this.flame
      .setPosition(this.ship.x + Math.cos(back) * rear, this.ship.y + Math.sin(back) * rear)
      .setRotation(back)
      .setScale(0.35 + throttle * 0.75 + level * 1.4, 0.8 + level * 0.35);
    // Your glow color at normal thrust, blue-white at full cruise (no per-frame allocation).
    const base = this.flameNormal;
    const r = Math.round(base.r + (FLAME_CRUISE.r - base.r) * level);
    const g = Math.round(base.g + (FLAME_CRUISE.g - base.g) * level);
    const b = Math.round(base.b + (FLAME_CRUISE.b - base.b) * level);
    this.flame.setTint((r << 16) | (g << 8) | b);
  }

  private updateBackdrop(): void {
    const cam = this.cameras.main;
    // Counter the camera zoom so the star layers always cover the screen,
    // anchored at the screen center (the point the zoom scales around).
    const inv = 1 / cam.zoom;
    this.farStars.setPosition(cam.width / 2, cam.height / 2).setScale(inv);
    this.nearStars.setPosition(cam.width / 2, cam.height / 2).setScale(inv);
    this.farStars.setTilePosition(cam.scrollX * FAR_PARALLAX, cam.scrollY * FAR_PARALLAX);
    this.nearStars.setTilePosition(cam.scrollX * NEAR_PARALLAX, cam.scrollY * NEAR_PARALLAX);

    // Point toward the system's star, and each port, whenever off screen.
    const r = Math.min(cam.width, cam.height) * ARROW_RING;
    const starVisible = cam.worldView.contains(this.star.x, this.star.y);
    this.homeArrow.setVisible(!starVisible);
    if (!starVisible) {
      const angle = Math.atan2(this.star.y - this.ship.y, this.star.x - this.ship.x);
      this.homeArrow.setPosition(cam.width / 2 + Math.cos(angle) * r, cam.height / 2 + Math.sin(angle) * r).setRotation(angle);
    }
    const pr = r * 0.88;
    for (const { poi, arrow } of this.poiViews) {
      const visible = cam.worldView.contains(poi.x, poi.y) || poi.id === this.objectivePoi;
      arrow.setVisible(!visible);
      if (visible) continue;
      const angle = Math.atan2(poi.y - this.ship.y, poi.x - this.ship.x);
      arrow.setPosition(cam.width / 2 + Math.cos(angle) * pr, cam.height / 2 + Math.sin(angle) * pr).setRotation(angle);
    }
    const target = this.objectivePos;
    const showObjective = target !== null && !cam.worldView.contains(target.x, target.y);
    this.objectiveArrow.setVisible(showObjective);
    if (target && showObjective) {
      const angle = Math.atan2(target.y - this.ship.y, target.x - this.ship.x);
      const or = r * 0.76;
      this.objectiveArrow.setPosition(cam.width / 2 + Math.cos(angle) * or, cam.height / 2 + Math.sin(angle) * or).setRotation(angle);
    }
    for (const { body, arrow } of this.portArrows) {
      const visible = cam.worldView.contains(body.x, body.y);
      arrow.setVisible(!visible);
      if (visible) continue;
      const angle = Math.atan2(body.y - this.ship.y, body.x - this.ship.x);
      arrow.setPosition(cam.width / 2 + Math.cos(angle) * pr, cam.height / 2 + Math.sin(angle) * pr).setRotation(angle);
    }
  }

  // ------------------------------------------------------------------ input

  private resetStick(): void {
    this.stickPointerId = null;
    this.stick = IDLE;
    this.ring.setVisible(false);
    this.knob.setVisible(false);
  }

  private setupInput(): void {
    this.input.addPointer(2); // multi-touch: stick + future fire button

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      // Left 60% of the screen is the movement zone.
      if (this.picking || this.stickPointerId !== null || p.x > this.scale.width * 0.6) return;
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
      if (p.id !== this.stickPointerId) return;
      this.resetStick();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);
    // iOS cancels touches on system gestures and app switches; never leave the stick stuck.
    const onBlur = (): void => {
      this.resetStick();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    // Game-level listeners outlive the scene; remove ours so a restart doesn't stack them.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
    });
  }
}
