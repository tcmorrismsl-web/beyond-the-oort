import Phaser from 'phaser';
import { gameData } from '../data/schema';
import type { Session } from '../core/session';
import { button, createLayer, el, type Layer } from '../ui/dom';
import { getSession } from './sessionAccess';
import { addStarBackdrop, onScreenResize } from './resize';

/** How long the "tap again to confirm" state lasts for New Game over a save. */
const CONFIRM_MS = 3000;

/**
 * Title: Continue where you left off (landed or in flight), or start a new
 * captain. Starting over when a save exists needs a second tap, because it
 * replaces that save.
 */
export class TitleScene extends Phaser.Scene {
  private session!: Session;
  private ui!: Layer;
  private backdrop!: { far: Phaser.GameObjects.TileSprite; near: Phaser.GameObjects.TileSprite };
  private drift = 0;
  private leaving = false;

  constructor() {
    super('title');
  }

  create(): void {
    this.session = getSession(this);
    this.drift = 0;
    this.leaving = false;
    this.backdrop = addStarBackdrop(this);
    this.fit();
    onScreenResize(this, () => {
      this.fit();
    });
    this.cameras.main.fadeIn(400, 5, 6, 10);

    this.ui = createLayer('title');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ui.destroy();
    });

    const hasSave = this.session.started === 'resumed';
    const buttons = el('div', 'row');
    if (hasSave) {
      const state = this.session.state;
      const where =
        state.landedAt !== null
          ? (gameData.sites.get(state.landedAt)?.site.name ?? '')
          : (gameData.systems.get(state.systemId)?.name ?? '');
      buttons.append(
        button(`Continue · ${where}`, () => {
          this.go(state.mode === 'landed' ? 'landed' : 'flight');
        }, 'primary'),
      );
      let armed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const newBtn = button('New game', () => {
        if (!armed) {
          armed = true;
          newBtn.textContent = 'Tap again to create a new captain';
          timer = setTimeout(() => {
            armed = false;
            newBtn.textContent = 'New game';
          }, CONFIRM_MS);
          return;
        }
        clearTimeout(timer);
        this.startNew();
      });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        clearTimeout(timer);
      });
      buttons.append(newBtn);
    } else {
      buttons.append(
        button('Start', () => {
          this.startNew();
        }, 'primary'),
      );
    }

    // The app icon doubles as the title mark: a little solar system inside the Oort Cloud.
    const logo = el('img', 'title-logo');
    logo.src = './icons/icon-512.png';
    logo.alt = '';
    const wrap = el('div', 'title-wrap', logo, el('h1', '', 'BEYOND THE OORT'), el('div', 'tag', 'A space RPG'), buttons);
    if (this.session.started === 'recovered') {
      wrap.append(el('div', 'note', "Your previous save couldn't be read, so a new game was started. A backup copy was kept."));
    }
    this.ui.root.append(el('div', 'screen', wrap));
  }

  override update(_t: number, deltaMs: number): void {
    if (this.cameras.main.width !== this.scale.width || this.cameras.main.height !== this.scale.height) this.fit();
    // Slow drift so the title screen feels alive.
    this.drift += deltaMs * 0.01;
    this.backdrop.far.setTilePosition(this.drift * 0.3, this.drift * 0.1);
    this.backdrop.near.setTilePosition(this.drift * 0.8, this.drift * 0.25);
  }

  private fit(): void {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.backdrop.far.setSize(width, height);
    this.backdrop.near.setSize(width, height);
  }

  /** New game goes through character creation; the old save is only replaced at Launch. */
  private startNew(): void {
    this.go('create');
  }

  private go(key: 'flight' | 'landed' | 'create'): void {
    if (this.leaving) return; // ignore double taps during the fade
    this.leaving = true;
    this.cameras.main.fadeOut(250, 5, 6, 10);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(key);
    });
  }
}
