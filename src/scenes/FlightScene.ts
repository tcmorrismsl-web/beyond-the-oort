import Phaser from 'phaser';
import { gameData } from '../data/schema';
import { consumeSteps, stepShip, STEP, type ShipKinematics } from '../systems/flight';
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

export class FlightScene extends Phaser.Scene {
  private ship!: Phaser.GameObjects.Image;
  private accumulator = 0;
  private sinceSave = 0;
  private stick: StickReading = IDLE;
  private stickPointerId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private ring!: Phaser.GameObjects.Image;
  private knob!: Phaser.GameObjects.Image;
  private farStars!: Phaser.GameObjects.TileSprite;
  private nearStars!: Phaser.GameObjects.TileSprite;
  private sun!: Phaser.GameObjects.Image;
  private homeArrow!: Phaser.GameObjects.Image;

  constructor() {
    super('flight');
  }

  create(): void {
    const session = getSession(this);
    const ship = session.state.ship;
    const def = gameData.ships.get(ship.defId);
    if (!def) throw new Error(`ship "${ship.defId}" missing from data`);

    const { width, height } = this.scale;
    this.farStars = this.add.tileSprite(0, 0, width, height, 'stars-far').setOrigin(0).setScrollFactor(0).setDepth(-20);
    this.nearStars = this.add.tileSprite(0, 0, width, height, 'stars-near').setOrigin(0).setScrollFactor(0).setDepth(-19);
    this.sun = this.add.image(0, 0, 'sun').setDepth(-10);
    this.homeArrow = this.add.image(0, 0, 'home-arrow').setScrollFactor(0).setDepth(5).setVisible(false);

    this.ship = this.add.image(ship.x, ship.y, 'ship').setRotation(ship.angle);
    this.cameras.main.startFollow(this.ship, true, 0.12, 0.12);
    this.cameras.main.centerOn(ship.x, ship.y);
    this.handleResize();

    this.ring = this.add.image(0, 0, 'stick-ring').setScrollFactor(0).setVisible(false).setDepth(10);
    this.knob = this.add.image(0, 0, 'stick-knob').setScrollFactor(0).setVisible(false).setDepth(11);
    this.setupInput();

    this.events.on(Phaser.Scenes.Events.UPDATE, (_t: number, deltaMs: number) => {
      const { steps, remainder } = consumeSteps(this.accumulator, deltaMs / 1000);
      this.accumulator = remainder;
      let kin: ShipKinematics = ship;
      for (let i = 0; i < steps; i += 1) {
        kin = stepShip(kin, def, { throttle: this.stick.throttle, targetAngle: this.stick.angle }, STEP);
      }
      Object.assign(ship, kin);
      this.ship.setPosition(ship.x, ship.y).setRotation(ship.angle);
      this.updateBackdrop();

      this.sinceSave += steps * STEP;
      if (this.sinceSave >= AUTOSAVE_SECONDS) {
        this.sinceSave = 0;
        session.save(Date.now());
      }
    });
  }

  /**
   * Rotating the phone resizes the game. Phaser only auto-resizes a camera
   * that exactly matched the old size, which iOS rotation can break, so we
   * resize the camera and background ourselves and re-center on the ship.
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

  private updateBackdrop(): void {
    const cam = this.cameras.main;
    this.farStars.setTilePosition(cam.scrollX * FAR_PARALLAX, cam.scrollY * FAR_PARALLAX);
    this.nearStars.setTilePosition(cam.scrollX * NEAR_PARALLAX, cam.scrollY * NEAR_PARALLAX);

    // Point toward the system's star whenever it is off screen.
    const view = cam.worldView;
    const sunVisible = view.contains(this.sun.x, this.sun.y);
    this.homeArrow.setVisible(!sunVisible);
    if (!sunVisible) {
      const dx = this.sun.x - this.ship.x;
      const dy = this.sun.y - this.ship.y;
      const angle = Math.atan2(dy, dx);
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
