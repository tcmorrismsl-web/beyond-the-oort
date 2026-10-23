import Phaser from 'phaser';
import { gameData } from '../data/schema';
import { Rng, freshSeed } from '../core/rng';
import { consumeSteps, stepShip, STEP, type ShipKinematics } from '../systems/flight';
import { IDLE, readStick, type StickReading } from '../ui/joystick';
import { getSession } from './sessionAccess';

const STICK_RADIUS = 60;
const WORLD = 6000;
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

  constructor() {
    super('flight');
  }

  create(): void {
    const session = getSession(this);
    const ship = session.state.ship;
    const def = gameData.ships.get(ship.defId);
    if (!def) throw new Error(`ship "${ship.defId}" missing from data`);

    // Background stars are cosmetic, so they use their own seed rather than
    // consuming rolls from the gameplay seed.
    const rng = new Rng(freshSeed());
    for (let i = 0; i < 900; i += 1) {
      const star = this.add.image(rng.range(-WORLD, WORLD), rng.range(-WORLD, WORLD), 'star');
      star.setAlpha(rng.range(0.2, 0.9)).setScale(rng.range(0.3, 1));
      star.setScrollFactor(rng.range(0.3, 1));
    }

    this.ship = this.add.image(ship.x, ship.y, 'ship').setRotation(ship.angle);
    this.cameras.main.startFollow(this.ship, true, 0.12, 0.12);

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

      this.sinceSave += steps * STEP;
      if (this.sinceSave >= AUTOSAVE_SECONDS) {
        this.sinceSave = 0;
        session.save(Date.now());
      }
    });
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
      this.stickPointerId = null;
      this.stick = IDLE;
      this.ring.setVisible(false);
      this.knob.setVisible(false);
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);
    // iOS cancels touches on system gestures and app switches; never leave the stick stuck.
    const onBlur = (): void => {
      this.stickPointerId = null;
      this.stick = IDLE;
      this.ring.setVisible(false);
      this.knob.setVisible(false);
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    // Game-level listeners outlive the scene; remove ours so a restart doesn't stack them.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
    });
  }
}
