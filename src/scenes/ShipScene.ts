import Phaser from 'phaser';
import type { Session } from '../core/session';
import { createLayer, el, type Layer } from '../ui/dom';
import { renderShip } from '../ui/panels';
import { getSession } from './sessionAccess';
import { addStarBackdrop, onScreenResize } from './resize';
import type { FlightResumeData } from './FlightScene';

/** Your ship and captain at a glance (stats, upgrades, hold, locker). Opened over sleeping flight. */
export class ShipScene extends Phaser.Scene {
  private session!: Session;
  private ui!: Layer;
  private backdrop!: { far: Phaser.GameObjects.TileSprite; near: Phaser.GameObjects.TileSprite };

  constructor() {
    super('ship');
  }

  create(): void {
    this.session = getSession(this);
    this.backdrop = addStarBackdrop(this);
    this.fit();
    onScreenResize(this, () => {
      this.fit();
    });
    this.ui = createLayer('ship');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ui.destroy();
    });
    const card = el('div', 'card');
    renderShip(card, this.session, () => {
      this.scene.stop();
      this.scene.wake('flight', {} satisfies FlightResumeData);
    });
    this.ui.root.append(el('div', 'screen', card));
  }

  override update(): void {
    if (this.cameras.main.width !== this.scale.width || this.cameras.main.height !== this.scale.height) this.fit();
  }

  private fit(): void {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.backdrop.far.setSize(width, height);
    this.backdrop.near.setSize(width, height);
  }
}
