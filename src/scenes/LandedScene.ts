import Phaser from 'phaser';
import { gameData, type Service, type Site } from '../data/schema';
import type { Session } from '../core/session';
import { button, createLayer, credits, el, type Layer } from '../ui/dom';
import { openSheet, renderDialogue, renderDrydock, renderMarket, shortName } from '../ui/panels';
import { dialoguesAt } from '../systems/dialogue';
import { waitingAt } from '../systems/crew';
import { entryOpen } from '../systems/onfoot';
import type { OnFootData } from './OnFootScene';
import { portraitSvg, setSvg } from '../ui/art';
import { showToast } from '../ui/toast';
import { getSession } from './sessionAccess';
import { addStarBackdrop, onScreenResize } from './resize';
import { ensureBodyTexture } from './systemTextures';

/** Display name for each service, and which update brings it to life. */
const SERVICE_INFO: Record<Service, { label: string; arrives: string | null }> = {
  trade: { label: 'Market', arrives: null },
  drydock: { label: 'Drydock', arrives: null },
  repair: { label: 'Repairs', arrives: 'Combat update' },
  missions: { label: 'Jobs', arrives: 'side stories update' },
  bar: { label: 'Bar', arrives: null },
};

const SITE_KIND: Record<Site['kind'], string> = {
  city: 'City spaceport',
  spaceport: 'Spaceport',
  settlement: 'Settlement',
  outpost: 'Outpost',
  station: 'Station deck',
  waystation: 'Waystation',
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
  private creditsLine!: HTMLDivElement;

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
    this.creditsLine = el('div', 'chip', credits(state.credits));
    head.append(this.creditsLine);
    const card = el('div', 'card port', head);

    // Services: only what this site has, in its own words; people first.
    const list = el('div', 'svc-list port-svc');
    this.fillServices(list, site);
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

  /** People here, then services. Rebuilt after each conversation (talking can change who's around). */
  private fillServices(list: HTMLDivElement, site: Site): void {
    list.replaceChildren();
    const refresh = (): void => {
      this.creditsLine.textContent = credits(this.session.state.credits);
      this.fillServices(list, site);
    };
    const state = this.session.state;
    // Somewhere here you can walk around in.
    if (entryOpen(site.interior, state)) {
      const entry = site.interior;
      const go = button(entry.label, () => {
        this.walkIn(entry.id);
      }, 'small primary');
      go.style.marginTop = '8px';
      list.append(el('div', 'svc person', el('b', '', gameData.interiors.get(entry.id)?.name ?? entry.label), el('div', 'sub', 'On foot'), go));
    }
    for (const d of dialoguesAt(site.id, gameData.dialogues, state)) {
      const who = d.character === undefined ? undefined : gameData.characters.get(d.character);
      const talk = button(who ? `Talk to ${d.speaker}` : d.title, () => {
        openSheet(this.ui.root, (sheetCard, close) => {
          renderDialogue(sheetCard, this.session, d.id, () => {
            close();
            refresh();
          });
        });
      }, 'small primary');
      talk.style.marginTop = '8px';
      const row = el('div', 'svc person');
      if (who) {
        const face = el('div', 'portrait-box tiny');
        setSvg(face, portraitSvg(who.look));
        row.classList.add('crew-row');
        row.append(face, el('div', '', el('b', '', d.speaker), el('div', 'sub', d.role), talk));
      } else {
        row.append(el('b', '', d.title), el('div', 'sub', d.role), talk);
      }
      list.append(row);
    }
    // Old shipmates waiting here can come back aboard.
    for (const c of waitingAt(site.id, state, gameData)) {
      const face = el('div', 'portrait-box tiny');
      setSvg(face, portraitSvg(c.look));
      const invite = button(`Invite ${shortName(c.name)} back aboard`, () => {
        if (this.session.invite(c.id, Date.now())) showToast(`${shortName(c.name)} is back aboard`);
        refresh();
      }, 'small');
      invite.style.marginTop = '8px';
      list.append(el('div', 'svc person crew-row', face, el('div', '', el('b', '', c.name), el('div', 'sub', c.role), invite)));
    }
    for (const svc of site.services) {
      const info = SERVICE_INFO[svc];
      const note = site.notes[svc] ?? '';
      const row = el('div', 'svc', el('b', '', info.label));
      if (note) row.append(el('div', 'svc-note', note));
      if (svc === 'trade' || svc === 'drydock') {
        const open = button(svc === 'trade' ? 'Open market' : 'Open drydock', () => {
          openSheet(this.ui.root, (sheetCard, close) => {
            if (svc === 'trade') renderMarket(sheetCard, this.session, close, refresh);
            else renderDrydock(sheetCard, this.session, close, refresh);
          });
        }, 'small');
        open.style.marginTop = '8px';
        row.append(open);
      } else if (info.arrives) {
        row.append(el('div', 'svc-soon', `Opens with the ${info.arrives}`));
      }
      list.append(row);
    }
    if (site.services.length === 0 && list.childElementCount === 0) {
      list.append(el('div', 'svc svc-dim', el('b', '', 'Nobody here'), el('div', 'svc-note', site.emptyNote ?? 'Nothing for sale and nobody to talk to.')));
    } else if (site.services.length === 0 && site.emptyNote) {
      list.append(el('div', 'svc svc-dim', el('div', 'svc-note', site.emptyNote)));
    }
  }

  override update(): void {
    if (this.cameras.main.width !== this.scale.width || this.cameras.main.height !== this.scale.height) this.fit();
  }

  private walkIn(interiorId: string): void {
    if (this.leaving || !this.session.enterInterior()) return;
    this.leaving = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('onfoot', { interior: interiorId } satisfies OnFootData);
    });
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
