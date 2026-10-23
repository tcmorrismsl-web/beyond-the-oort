import Phaser from 'phaser';
import { gameData, type CreationChoice } from '../data/schema';
import type { Session } from '../core/session';
import { freshSeed, Rng } from '../core/rng';
import { cleanName, DEFAULT_LOOK, DEFAULT_PAINT, DEFAULT_SHIP_NAME, MAX_NAME_LENGTH, startingCredits, type Captain, type Look, type Paint, type Pronouns } from '../core/state';
import { button, chips, createLayer, credits, el, swatches, type Layer } from '../ui/dom';
import { portraitSvg, setSvg, shipSvg } from '../ui/art';
import { showToast } from '../ui/toast';
import { getSession } from './sessionAccess';
import { addStarBackdrop, onScreenResize } from './resize';

type Step = 'name' | 'look' | 'origin' | 'moment' | 'motive' | 'ship' | 'summary';
const STEPS: readonly Step[] = ['name', 'look', 'origin', 'moment', 'motive', 'ship', 'summary'];
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
  private draft = this.emptyDraft();
  private drift = 0;
  private leaving = false;

  constructor() {
    super('create');
  }

  private emptyDraft(): { name: string; pronouns: Pronouns; origin: string; moment: string; motive: string; shipName: string; look: Look; paint: Paint } {
    return { name: '', pronouns: 'they', origin: '', moment: '', motive: '', shipName: '', look: { ...DEFAULT_LOOK }, paint: { ...DEFAULT_PAINT } };
  }

  create(): void {
    this.session = getSession(this);
    this.step = 'name';
    this.draft = this.emptyDraft();
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
      case 'look':
        this.renderLook(card);
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

  /**
   * An option row that rebuilds only itself when you pick (the card doesn't
   * re-render, so the page doesn't jump back to the top on a phone).
   */
  private optionRow(label: string, build: (refresh: () => void) => HTMLElement, onChange: () => void): HTMLElement {
    const holder = el('div', 'opt-row', el('div', 'sub section', label));
    const slot = el('div');
    const refresh = (): void => {
      slot.replaceChildren(build(refresh));
      onChange();
    };
    slot.append(build(refresh));
    holder.append(slot);
    return holder;
  }

  private renderLook(card: HTMLElement): void {
    const a = gameData.appearance.captain;
    const look = this.draft.look;
    card.append(el('h1', '', 'What do you look like?'));
    const preview = el('div', 'portrait-box');
    const updatePreview = (): void => {
      setSvg(preview, portraitSvg(look));
    };
    updatePreview();
    const randomize = button('Surprise me', () => {
      const rng = new Rng(freshSeed());
      look.face = rng.pick(a.faces).id;
      look.skin = rng.pick(a.skinTones);
      look.hair = rng.pick(a.hairStyles).id;
      look.hairColor = rng.pick(a.hairColors);
      look.eyes = rng.pick(a.eyeColors);
      look.outfit = rng.pick(a.outfits).id;
      look.outfitColor = rng.pick(a.outfitColors);
      this.render();
    }, 'small');
    const options = el(
      'div',
      'look-options',
      this.optionRow('Face', (r) => chips(a.faces, look.face, (v) => { look.face = v; r(); }), updatePreview),
      this.optionRow('Skin', (r) => swatches(a.skinTones, look.skin, (v) => { look.skin = v; r(); }, 'Skin tone'), updatePreview),
      this.optionRow('Hair', (r) => chips(a.hairStyles, look.hair, (v) => { look.hair = v; r(); }), updatePreview),
      this.optionRow('Hair color', (r) => swatches(a.hairColors, look.hairColor, (v) => { look.hairColor = v; r(); }, 'Hair color'), updatePreview),
      this.optionRow('Eyes', (r) => swatches(a.eyeColors, look.eyes, (v) => { look.eyes = v; r(); }, 'Eye color'), updatePreview),
      this.optionRow('Outfit', (r) => chips(a.outfits, look.outfit, (v) => { look.outfit = v; r(); }), updatePreview),
      this.optionRow('Outfit color', (r) => swatches(a.outfitColors, look.outfitColor, (v) => { look.outfitColor = v; r(); }, 'Outfit color'), updatePreview),
    );
    card.append(el('div', 'look-grid', el('div', 'look-preview', preview, randomize), options));
    this.nav(card, true);
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

    const a = gameData.appearance.ship;
    const paint = this.draft.paint;
    const preview = el('div', 'ship-box');
    const updatePreview = (): void => {
      setSvg(preview, shipSvg(paint));
    };
    updatePreview();
    card.append(el('div', 'sub section', 'Paint her'));
    const options = el(
      'div',
      'look-options',
      this.optionRow('Hull', (r) => swatches(a.hullColors, paint.hull, (v) => { paint.hull = v; r(); }, 'Hull color'), updatePreview),
      this.optionRow('Accent', (r) => swatches(a.accentColors, paint.accent, (v) => { paint.accent = v; r(); }, 'Accent color'), updatePreview),
      this.optionRow('Pattern', (r) => chips(a.patterns, paint.pattern, (v) => { paint.pattern = v; r(); }), updatePreview),
      this.optionRow('Engine glow', (r) => swatches(a.glowColors, paint.glow, (v) => { paint.glow = v; r(); }, 'Engine glow'), updatePreview),
    );
    card.append(el('div', 'look-grid', el('div', 'look-preview', preview), options));
    card.append(el('div', 'note', 'You can repaint her later at any drydock.'));
    this.nav(card, true);
  }

  private captain(): Captain {
    return {
      name: cleanName(this.draft.name, 'Captain'),
      pronouns: this.draft.pronouns,
      origin: this.draft.origin,
      moment: this.draft.moment,
      motive: this.draft.motive,
      look: { ...this.draft.look },
    };
  }

  private renderSummary(card: HTMLElement): void {
    const cap = this.captain();
    const c = gameData.creation;
    const find = (list: readonly CreationChoice[], id: string): CreationChoice | undefined => list.find((x) => x.id === id);
    const shipName = cleanName(this.draft.shipName, DEFAULT_SHIP_NAME);
    const portrait = el('div', 'portrait-box small');
    setSvg(portrait, portraitSvg(cap.look));
    const ship = el('div', 'ship-box small');
    setSvg(ship, shipSvg(this.draft.paint));
    card.append(el('div', 'summary-head', portrait, el('div', '', el('h1', '', `Captain ${cap.name}`), el('div', 'sub', `of the ${shipName}`), ship)));
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
      this.session.startCareer(freshSeed(), Date.now(), { captain: cap, shipName, paint: { ...this.draft.paint } });
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
