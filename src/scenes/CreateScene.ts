import Phaser from 'phaser';
import { gameData, type CreationChoice } from '../data/schema';
import type { Session } from '../core/session';
import { freshSeed } from '../core/rng';
import { cleanName, DEFAULT_SHIP_NAME, MAX_NAME_LENGTH, startingCredits, type Captain, type Pronouns } from '../core/state';
import { button, createLayer, credits, el, type Layer } from '../ui/dom';
import { showToast } from '../ui/toast';
import { getSession } from './sessionAccess';
import { addStarBackdrop, onScreenResize } from './resize';

type Step = 'name' | 'origin' | 'moment' | 'motive' | 'ship' | 'summary';
const STEPS: readonly Step[] = ['name', 'origin', 'moment', 'motive', 'ship', 'summary'];
const PRONOUNS: { id: Pronouns; label: string }[] = [
  { id: 'she', label: 'She / her' },
  { id: 'he', label: 'He / him' },
  { id: 'they', label: 'They / them' },
];

/**
 * Mass Effect-inspired character creation (original content): who you are,
 * where you're from, what shaped you, why you fly, and your ship's name.
 * Nothing is saved (and no existing save is replaced) until Launch.
 */
export class CreateScene extends Phaser.Scene {
  private session!: Session;
  private ui!: Layer;
  private backdrop!: { far: Phaser.GameObjects.TileSprite; near: Phaser.GameObjects.TileSprite };
  private step: Step = 'name';
  private draft = { name: '', pronouns: 'they' as Pronouns, origin: '', moment: '', motive: '', shipName: '' };
  private drift = 0;
  private leaving = false;

  constructor() {
    super('create');
  }

  create(): void {
    this.session = getSession(this);
    this.step = 'name';
    this.draft = { name: '', pronouns: 'they', origin: '', moment: '', motive: '', shipName: '' };
    this.drift = 0;
    this.leaving = false;
    this.backdrop = addStarBackdrop(this);
    this.fit();
    onScreenResize(this, () => {
      this.fit();
    });
    this.cameras.main.fadeIn(300, 5, 6, 10);
    this.ui = createLayer('create');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ui.destroy();
    });
    this.render();
  }

  override update(_t: number, deltaMs: number): void {
    if (this.cameras.main.width !== this.scale.width || this.cameras.main.height !== this.scale.height) this.fit();
    this.drift += deltaMs * 0.006;
    this.backdrop.far.setTilePosition(this.drift * 0.3, this.drift * 0.1);
    this.backdrop.near.setTilePosition(this.drift * 0.8, this.drift * 0.25);
  }

  private fit(): void {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.backdrop.far.setSize(width, height);
    this.backdrop.near.setSize(width, height);
  }

  // ------------------------------------------------------------------ steps

  private render(): void {
    const card = el('div', 'card create');
    const index = STEPS.indexOf(this.step);
    card.append(el('div', 'sub step-count', `Step ${index + 1} of ${STEPS.length}`));
    switch (this.step) {
      case 'name':
        this.renderName(card);
        break;
      case 'origin':
        this.renderChoice(card, 'Where are you from?', gameData.creation.origins, 'origin');
        break;
      case 'moment':
        this.renderChoice(card, 'What shaped you?', gameData.creation.moments, 'moment');
        break;
      case 'motive':
        this.renderChoice(card, 'Why do you fly?', gameData.creation.motives, 'motive');
        break;
      case 'ship':
        this.renderShip(card);
        break;
      case 'summary':
        this.renderSummary(card);
        break;
    }
    this.ui.root.replaceChildren(el('div', 'screen', card));
  }

  private nav(card: HTMLElement, canNext: boolean, nextLabel = 'Next', onNext?: () => void): void {
    const back = button(this.step === 'name' ? 'Cancel' : 'Back', () => {
      this.back();
    });
    const next = button(nextLabel, () => {
      if (onNext) onNext();
      else this.next();
    }, 'primary');
    next.disabled = !canNext;
    card.append(el('div', 'row nav-row', back, next));
  }

  private next(): void {
    const i = STEPS.indexOf(this.step);
    const n = STEPS[i + 1];
    if (n) {
      this.step = n;
      this.render();
    }
  }

  private back(): void {
    const i = STEPS.indexOf(this.step);
    const p = STEPS[i - 1];
    if (p) {
      this.step = p;
      this.render();
    } else {
      this.leave('title');
    }
  }

  private textInput(value: string, placeholder: string, onInput: (v: string) => void): HTMLInputElement {
    const input = el('input', 'text-input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = MAX_NAME_LENGTH;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => {
      onInput(input.value);
    });
    // Keep typing keys from reaching anything else in the game.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });
    return input;
  }

  private renderName(card: HTMLElement): void {
    card.append(el('h1', '', 'Every captain has a story'), el('p', '', 'What should people call you?'));
    const nextBtnState = (): void => {
      const btn = card.querySelector<HTMLButtonElement>('.nav-row .primary');
      if (btn) btn.disabled = this.draft.name.trim().length === 0;
    };
    card.append(
      this.textInput(this.draft.name, 'Your name', (v) => {
        this.draft.name = v;
        nextBtnState();
      }),
    );
    const row = el('div', 'row');
    for (const p of PRONOUNS) {
      row.append(
        button(p.label, () => {
          this.draft.pronouns = p.id;
          this.render();
        }, this.draft.pronouns === p.id ? 'primary small' : 'small'),
      );
    }
    card.append(el('div', 'sub section', 'Pronouns'), row);
    this.nav(card, this.draft.name.trim().length > 0);
  }

  private renderChoice(card: HTMLElement, title: string, choices: readonly CreationChoice[], key: 'origin' | 'moment' | 'motive'): void {
    card.append(el('h1', '', title));
    const selected = choices.find((c) => c.id === this.draft[key]);
    const list = el('div', 'choices');
    for (const c of choices) {
      const b = button(c.name, () => {
        this.draft[key] = c.id;
        this.render();
      }, c.id === this.draft[key] ? 'pick picked' : 'pick');
      b.append(el('small', '', c.blurb));
      list.append(b);
    }
    card.append(list);
    if (selected) card.append(el('p', 'choice-text', selected.text));
    this.nav(card, selected !== undefined);
  }

  private renderShip(card: HTMLElement): void {
    const moment = gameData.creation.moments.find((m) => m.id === this.draft.moment);
    card.append(el('h1', '', 'Your ship'), el('p', '', gameData.creation.ship.intro));
    if (moment?.shipStory) card.append(el('p', 'choice-text', moment.shipStory));
    card.append(el('div', 'sub section', 'What do you call her?'));
    const input = this.textInput(this.draft.shipName, DEFAULT_SHIP_NAME, (v) => {
      this.draft.shipName = v;
    });
    card.append(input);
    const ideas = el('div', 'row');
    for (const name of gameData.creation.ship.nameSuggestions) {
      ideas.append(
        button(name, () => {
          this.draft.shipName = name;
          input.value = name;
        }, 'small'),
      );
    }
    card.append(ideas);
    this.nav(card, true);
  }

  private captain(): Captain {
    return {
      name: cleanName(this.draft.name, 'Captain'),
      pronouns: this.draft.pronouns,
      origin: this.draft.origin,
      moment: this.draft.moment,
      motive: this.draft.motive,
    };
  }

  private renderSummary(card: HTMLElement): void {
    const cap = this.captain();
    const c = gameData.creation;
    const find = (list: readonly CreationChoice[], id: string): CreationChoice | undefined => list.find((x) => x.id === id);
    const shipName = cleanName(this.draft.shipName, DEFAULT_SHIP_NAME);
    card.append(el('h1', '', `Captain ${cap.name}`), el('div', 'sub', `of the ${shipName}`));
    for (const [label, choice] of [
      ['From', find(c.origins, cap.origin)],
      ['Shaped by', find(c.moments, cap.moment)],
      ['Flying for', find(c.motives, cap.motive)],
    ] as const) {
      if (choice) card.append(el('div', 'svc', el('span', 'sub', `${label}  `), el('b', '', choice.name), el('div', 'svc-note', choice.blurb)));
    }
    card.append(el('p', 'choice-text', `You start in Sol with ${credits(startingCredits(cap))}, a ship nobody else has, and the whole charted galaxy ahead of you.`));
    if (this.session.started === 'resumed') {
      card.append(el('div', 'note', 'Launching replaces your current save.'));
    }
    this.nav(card, true, 'Launch', () => {
      if (this.leaving) return;
      this.session.startCareer(freshSeed(), Date.now(), { captain: cap, shipName });
      showToast(`Welcome aboard the ${shipName}`, 2400);
      this.leave('flight');
    });
  }

  private leave(key: 'title' | 'flight'): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(300, 5, 6, 10);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(key);
    });
  }
}
