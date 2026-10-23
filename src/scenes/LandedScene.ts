import Phaser from 'phaser';
import { gameData, type Service, type Site } from '../data/schema';
import type { Session } from '../core/session';
import { maxFuel } from '../core/state';
import { button, createLayer, el, fuelPips, type Layer } from '../ui/dom';
import { getSession } from './sessionAccess';
import { addStarBackdrop, onScreenResize } from './resize';
import { ensureBodyTexture } from './systemTextures';

/** Display name for each service, and which update brings it to life. */
const SERVICE_INFO: Record<Service, { label: string; arrives: string | null }> = {
  refuel: { label: 'Fuel', arrives: null },
  trade: { label: 'Market', arrives: 'Economy update' },
  shipyard: { label: 'Shipyard', arrives: 'Economy update' },
  outfitter: { label: 'Outfitter', arrives: 'Economy update' },
  repair: { label: 'Repairs', arrives: 'Combat update' },
  missions: { label: 'Jobs', arrives: 'Missions update' },
  bar: { label: 'Bar', arrives: 'Crew update' },
};

const SITE_KIND: Record<Site['kind'], string> = {
  city: 'City spaceport',
  spaceport: 'Spaceport',
  settlement: 'Settlement',
  outpost: 'Outpost',
  station: 'Station deck',
  depot: 'Fuel depot',
  mining: 'Mining camp',
  research: 'Research base',
  ruins: 'Ruins',
};

/**
 * The port screen for one landing site. Every site shows only what it
 * actually has, each in its own words (from content data), plus quick hops
 * to other sites on the same planet and a way back to space.
 */
export class LandedScene extends Phaser.Scene {
  private session!: Session;
  private ui!: Layer;
  private art!: Phaser.GameObjects.Image;
  private backdrop!: { far: Phaser.GameObjects.TileSprite; near: Phaser.GameObjects.TileSprite };
  private leaving = false;

  constructor() {
    super('landed');
  }

  create(): void {
    this.session = getSession(this);
    this.leaving = false;
    const state = this.session.state;
    const spot = state.landedAt === null ? undefined : gameData.sites.get(state.landedAt);
    if (!spot) {
      // Shouldn't happen (state is repaired on load), but never strand the player.
      this.scene.start('flight');
      return;
    }
    const { site, body } = spot;
    const system = gameData.systems.get(spot.systemId);

    this.backdrop = addStarBackdrop(this);
    this.art = this.add.image(0, 0, ensureBodyTexture(this, body));
    this.fit();
    onScreenResize(this, () => {
      this.fit();
    });
    this.cameras.main.fadeIn(250, 5, 6, 10);

    this.ui = createLayer('landed');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ui.destroy();
    });

    // Three areas laid out by CSS grid: stacked in portrait, two columns
    // (place + actions | services) on short landscape screens.
    const head = el(
      'div',
      'port-head',
      el('h1', '', site.name),
      el('div', 'sub', `${SITE_KIND[site.kind]} · ${body.name} · ${system?.name ?? spot.systemId}`),
      el('p', '', site.description),
    );
    const card = el('div', 'card port', head);

    // Services: only what this site has, in its own words.
    const list = el('div', 'svc-list port-svc');
    for (const svc of site.services) {
      const info = SERVICE_INFO[svc];
      const note = site.notes[svc] ?? '';
      const row = el('div', 'svc', el('b', '', info.label));
      if (svc === 'refuel') {
        row.append(' ', fuelPips(state.fuel, maxFuel(state.ship.defId)), el('div', 'svc-note', note || 'Tank topped up.'));
      } else {
        if (note) row.append(el('div', 'svc-note', note));
        if (info.arrives) row.append(el('div', 'svc-soon', `Opens with the ${info.arrives}`));
      }
      list.append(row);
    }
    if (!site.services.includes('refuel')) {
      list.append(el('div', 'svc svc-dim', el('b', '', 'No fuel here'), el('div', 'svc-note', 'Fuel is sold elsewhere in this system.')));
    }
    card.append(list);

    // Actions stay pinned to the bottom of the card, so Lift off is always
    // reachable without scrolling, even on a short landscape screen.
    const actions = el('div', 'actions port-act');
    const others = body.sites.filter((s) => s.id !== site.id);
    if (others.length > 0) {
      actions.append(el('div', 'sub', `Elsewhere on ${body.name}`));
      const row = el('div', 'row');
      for (const other of others) {
        row.append(
          button(other.name, () => {
            this.hop(other.id);
          }),
        );
      }
      actions.append(row);
    }
    const leaveLabel = body.kind === 'station' ? 'Undock' : 'Lift off';
    const depart = button(leaveLabel, () => {
      this.depart();
    }, 'primary');
    depart.style.width = '100%';
    actions.append(depart);
    card.append(actions);
    this.ui.root.append(el('div', 'screen', card));
  }

  override update(): void {
    if (this.cameras.main.width !== this.scale.width || this.cameras.main.height !== this.scale.height) this.fit();
  }

  private hop(siteId: string): void {
    if (this.leaving) return;
    if (!this.session.moveToSite(siteId, Date.now())) return;
    this.leaving = true;
    this.cameras.main.fadeOut(200, 5, 6, 10);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart();
    });
  }

  private depart(): void {
    if (this.leaving) return;
    if (!this.session.departPort(Date.now())) return;
    this.leaving = true;
    this.cameras.main.fadeOut(200, 5, 6, 10);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('flight');
    });
  }

  /** The planet/station art fills the background, peeking out behind the card. */
  private fit(): void {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.backdrop.far.setSize(width, height);
    this.backdrop.near.setSize(width, height);
    const target = Math.max(width, height) * 0.9;
    this.art.setScale(target / this.art.width).setPosition(width * 0.5, height * 0.95).setAlpha(0.9);
  }
}
