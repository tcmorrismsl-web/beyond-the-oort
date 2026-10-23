import Phaser from 'phaser';
import { gameData } from '../data/schema';
import { CRUISE_IDLE, consumeSteps, stepShip, STEP, updateCruise, type CruiseState, type ShipKinematics } from '../systems/flight';
import { IDLE, readStick, type StickReading } from '../ui/joystick';
import { getSession } from './sessionAccess';

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
const FLAME_NORMAL = { r: 0xff, g: 0xa0, b: 0x40 };
const FLAME_CRUISE = { r: 0x8f, g: 0xd8, b: 0xff };

/**
 * Two cameras: the main camera follows the ship and zooms with speed; a HUD
 * camera on top never zooms, so the joystick and arrow stay exactly under
 * the thumb. Every new object must be added to one of the two lists via
 * `world()` or `hud()`, or it will render on both cameras.
 */
export class FlightScene extends Phaser.Scene {
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
  private sun!: Phaser.GameObjects.Image;
  private homeArrow!: Phaser.GameObjects.Image;
  private hudCam!: Phaser.Cameras.Scene2D.Camera;

  constructor() {
    super('flight');
  }

  create(): void {
    const session = getSession(this);
    const ship = session.state.ship;
    const def = gameData.ships.get(ship.defId);
    if (!def) throw new Error(`ship "${ship.defId}" missing from data`);

    // Reset per-run fields: Phaser reuses the scene instance on restart.
    this.accumulator = 0;
    this.sinceSave = 0;
    this.cruise = CRUISE_IDLE;
    this.stick = IDLE;
    this.stickPointerId = null;

    const { width, height } = this.scale;
    this.hudCam = this.cameras.add(0, 0, width, height).setName('hud');

    // Star layers live in the world camera (so they sit behind the ship) but
    // ignore scrolling and counter the zoom, so they always fill the screen.
    this.farStars = this.world(this.add.tileSprite(width / 2, height / 2, width, height, 'stars-far').setScrollFactor(0).setDepth(-20));
    this.nearStars = this.world(this.add.tileSprite(width / 2, height / 2, width, height, 'stars-near').setScrollFactor(0).setDepth(-19));
    this.sun = this.world(this.add.image(0, 0, 'sun').setDepth(-10));
    this.flame = this.world(this.add.image(ship.x, ship.y, 'flame').setOrigin(0, 0.5).setVisible(false).setDepth(-1));
    this.ship = this.world(this.add.image(ship.x, ship.y, 'ship').setRotation(ship.angle));

    this.homeArrow = this.hud(this.add.image(0, 0, 'home-arrow').setDepth(5).setVisible(false));
    this.ring = this.hud(this.add.image(0, 0, 'stick-ring').setVisible(false).setDepth(10));
    this.knob = this.hud(this.add.image(0, 0, 'stick-knob').setVisible(false).setDepth(11));

    const cam = this.cameras.main;
    cam.startFollow(this.ship, true, 0.12, 0.12);
    cam.centerOn(ship.x, ship.y);
    this.handleResize();
    this.setupInput();

    this.events.on(Phaser.Scenes.Events.UPDATE, (_t: number, deltaMs: number) => {
      const { steps, remainder } = consumeSteps(this.accumulator, deltaMs / 1000);
      this.accumulator = remainder;
      let kin: ShipKinematics = ship;
      for (let i = 0; i < steps; i += 1) {
        this.cruise = updateCruise(this.cruise, this.stick.throttle, STEP);
        kin = stepShip(kin, def, { throttle: this.stick.throttle, targetAngle: this.stick.angle, cruise: this.cruise.level }, STEP);
        cam.setZoom(cam.zoom + (1 - (1 - CRUISE_ZOOM) * this.cruise.level - cam.zoom) * ZOOM_EASE);
        this.easeLookAhead(cam, kin);
      }
      Object.assign(ship, kin);
      this.ship.setPosition(ship.x, ship.y).setRotation(ship.angle);
      this.updateFlame();
      this.updateBackdrop();

      this.sinceSave += steps * STEP;
      if (this.sinceSave >= AUTOSAVE_SECONDS) {
        this.sinceSave = 0;
        session.save(Date.now());
      }
    });
  }

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

  /**
   * Rotating the phone resizes the game. Phaser only auto-resizes a camera
   * that exactly matched the old size, which iOS rotation can break, so we
   * resize the cameras and background ourselves and re-center on the ship.
   */
  private handleResize(): void {
    const onResize = (gameSize: Phaser.Structs.Size): void => {
      const { width, height } = gameSize;
      this.cameras.resize(width, height);
      this.cameras.main.centerOn(this.ship.x, this.ship.y);
      this.farStars.setSize(width, height);
      this.nearStars.setSize(width, height);
      this.resetStick();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
  }

  private updateFlame(): void {
    const throttle = this.stick.throttle;
    const level = this.cruise.level;
    const visible = throttle > 0.02 || level > 0.02;
    this.flame.setVisible(visible);
    if (!visible) return;
    const back = this.ship.rotation + Math.PI;
    const rear = this.ship.width / 2 - 2;
    this.flame
      .setPosition(this.ship.x + Math.cos(back) * rear, this.ship.y + Math.sin(back) * rear)
      .setRotation(back)
      .setScale(0.35 + throttle * 0.75 + level * 1.4, 0.8 + level * 0.35);
    // Orange at normal thrust, blue-white at full cruise (no per-frame allocation).
    const r = Math.round(FLAME_NORMAL.r + (FLAME_CRUISE.r - FLAME_NORMAL.r) * level);
    const g = Math.round(FLAME_NORMAL.g + (FLAME_CRUISE.g - FLAME_NORMAL.g) * level);
    const b = Math.round(FLAME_NORMAL.b + (FLAME_CRUISE.b - FLAME_NORMAL.b) * level);
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

    // Point toward the system's star whenever it is off screen.
    const sunVisible = cam.worldView.contains(this.sun.x, this.sun.y);
    this.homeArrow.setVisible(!sunVisible);
    if (!sunVisible) {
      const angle = Math.atan2(this.sun.y - this.ship.y, this.sun.x - this.ship.x);
      const r = Math.min(cam.width, cam.height) * ARROW_RING;
      this.homeArrow.setPosition(cam.width / 2 + Math.cos(angle) * r, cam.height / 2 + Math.sin(angle) * r).setRotation(angle);
    }
  }

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
      if (this.stickPointerId !== null || p.x > this.scale.width * 0.6) return;
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
