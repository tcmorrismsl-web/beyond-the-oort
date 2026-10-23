/**
 * Port panels (Market, Drydock) and the ship summary. Plain DOM built from
 * game state; every action goes through the Session (which saves), then the
 * panel re-renders itself. Shown as a sheet over the port screen.
 */
import { gameData, type Target, type UpgradeEffect } from '../data/schema';
import type { Session } from '../core/session';
import { cargoUsed, holdSize, maxBuyable, quote, tradeBlockText } from '../systems/market';
import { canRepaint, canUpgrade, statsFor, upgradeBlockText } from '../systems/ship';
import { crewTalks, nodeText, shownChoices } from '../systems/dialogue';
import { feelingWord } from '../systems/crew';
import { button, chips, credits, el, swatches } from './dom';
import { portraitSvg, setSvg, shipSvg } from './art';
import { freshSeed, Rng } from '../core/rng';
import type { GameState, Look, Paint } from '../core/state';
import { journal, routeTo } from '../systems/missions';
import { showToast } from './toast';

/** Open a sheet over the given layer; returns a function that closes it. */
export function openSheet(root: HTMLElement, build: (card: HTMLDivElement, close: () => void) => void): () => void {
  const card = el('div', 'card sheet-card');
  const sheet = el('div', 'screen sheet-screen', card);
  const close = (): void => {
    sheet.remove();
  };
  build(card, close);
  root.append(sheet);
  return close;
}

function pct(mult: number): string {
  return `+${Math.round((mult - 1) * 100)}%`;
}

/** Human-readable summary of what an upgrade tier does. */
export function effectText(e: UpgradeEffect): string {
  const parts: string[] = [];
  if (e.thrust !== undefined) parts.push(`${pct(e.thrust)} thrust`);
  if (e.maxSpeed !== undefined) parts.push(`${pct(e.maxSpeed)} top speed`);
  if (e.turnRate !== undefined) parts.push(`${pct(e.turnRate)} turning`);
  if (e.cruiseMultiplier !== undefined) parts.push(`cruise ×${e.cruiseMultiplier}`);
  if (e.cargo !== undefined) parts.push(`+${e.cargo} cargo`);
  if (e.hull !== undefined) parts.push(`+${e.hull} hull`);
  if (e.shields !== undefined) parts.push(`+${e.shields} shields`);
  return parts.join(', ');
}

// ------------------------------------------------------------------ Market

const AMOUNTS = [1, 5, 'max'] as const;
type Amount = (typeof AMOUNTS)[number];

export function renderMarket(card: HTMLDivElement, session: Session, close: () => void, onChange: () => void): void {
  let amount: Amount = 1;
  const draw = (): void => {
    const state = session.state;
    const siteId = state.landedAt;
    const site = siteId === null ? undefined : gameData.sites.get(siteId);
    card.replaceChildren();
    if (siteId === null || !site) {
      close();
      return;
    }
    const used = cargoUsed(state);
    const size = holdSize(state, gameData);
    card.append(
      el('h1', '', 'Market'),
      el('div', 'sub', `${site.site.name} · ${credits(state.credits)} · Hold ${used}/${size}`),
    );
    if (site.site.notes.trade) card.append(el('p', '', site.site.notes.trade));

    const picker = el('div', 'row amount-row', el('span', 'sub', 'Trade in lots of'));
    for (const a of AMOUNTS) {
      const b = button(a === 'max' ? 'Max' : String(a), () => {
        amount = a;
        draw();
      }, a === amount ? 'primary small' : 'small');
      picker.append(b);
    }
    card.append(picker);

    const list = el('div', 'trade-list');
    for (const c of gameData.commodities.values()) {
      const q = quote(siteId, c.id, gameData);
      if (!q) continue;
      const have = state.cargo[c.id] ?? 0;
      const buyQty = amount === 'max' ? maxBuyable(state, c.id, gameData) : amount;
      const sellQty = amount === 'max' ? have : Math.min(amount, have);
      const info = el(
        'div',
        'trade-info',
        el('b', '', c.name),
        ' ',
        el('span', `tag tag-${q.level}`, q.level),
        el('div', 'svc-note', `Buy ${q.buy} · Sell ${q.sell}${have > 0 ? ` · you have ${have}` : ''}`),
      );
      const buyBtn = button(`Buy${buyQty > 1 ? ` ${buyQty}` : ''}`, () => {
        const r = session.buyGoods(c.id, buyQty, Date.now());
        if (!r.ok) showToast(tradeBlockText(r.reason));
        draw();
        onChange();
      }, 'small');
      buyBtn.disabled = buyQty < 1;
      const sellBtn = button(`Sell${sellQty > 1 ? ` ${sellQty}` : ''}`, () => {
        const r = session.sellGoods(c.id, sellQty, Date.now());
        if (!r.ok) showToast(tradeBlockText(r.reason));
        draw();
        onChange();
      }, 'small');
      sellBtn.disabled = sellQty < 1;
      list.append(el('div', 'trade-row', info, el('div', 'trade-btns', buyBtn, sellBtn)));
    }
    card.append(list);
    card.append(el('div', 'note', 'Prices are fixed per port. Mission items and things you find go in your locker, which never fills up.'));
    const done = button('Done', close, 'primary');
    done.style.width = '100%';
    done.style.marginTop = '12px';
    card.append(done);
  };
  draw();
}

// ------------------------------------------------------------------ Drydock

export function renderDrydock(card: HTMLDivElement, session: Session, close: () => void, onChange: () => void): void {
  const draw = (): void => {
    const state = session.state;
    const site = state.landedAt === null ? undefined : gameData.sites.get(state.landedAt);
    card.replaceChildren();
    if (!site) {
      close();
      return;
    }
    card.append(el('h1', '', 'Drydock'), el('div', 'sub', `${state.shipName} · ${credits(state.credits)}`));
    if (site.site.notes.drydock) card.append(el('p', '', site.site.notes.drydock));
    const paintPreview = el('div', 'ship-box small');
    setSvg(paintPreview, shipSvg(state.paint));
    const paintBtn = button(`Repaint · ${credits(gameData.appearance.repaintCost)}`, () => {
      renderPaintShop(card, session, () => {
        draw();
        onChange();
      });
    }, 'small');
    card.append(el('div', 'svc paint-row', paintPreview, el('div', '', el('b', '', 'Paint shop'), el('div', 'svc-note', 'New colors, pattern and engine glow.'), paintBtn)));
    const list = el('div', 'svc-list port-upgrades');
    for (const track of gameData.upgrades) {
      const owned = state.upgrades[track.id] ?? 0;
      const current = owned > 0 ? track.tiers[owned - 1]?.name ?? 'Stock' : 'Stock';
      const next = track.tiers[owned];
      const row = el('div', 'svc', el('b', '', track.name), el('span', 'sub', `  ·  ${current}`), el('div', 'svc-note', track.description));
      if (track.note) row.append(el('div', 'svc-soon', track.note));
      if (next) {
        const check = canUpgrade(state, track.id, gameData);
        row.append(el('div', 'svc-note next-tier', `Next: ${next.name} — ${effectText(next.effect)}`));
        const b = button(check.ok || check.reason === 'credits' ? `Install · ${credits(next.cost)}` : upgradeBlockText(check.reason), () => {
          const r = session.upgradeShip(track.id, Date.now());
          if (r.ok) showToast(`${next.name} installed`);
          else showToast(upgradeBlockText(r.reason));
          draw();
          onChange();
        }, check.ok ? 'primary small' : 'small');
        b.disabled = !check.ok;
        b.style.marginTop = '8px';
        row.append(b);
      } else {
        row.append(el('div', 'svc-soon', 'Fully upgraded'));
      }
      list.append(row);
    }
    card.append(list);
    const done = button('Done', close, 'primary');
    done.style.width = '100%';
    done.style.marginTop = '12px';
    card.append(done);
  };
  draw();
}

// ------------------------------------------------------------------ Ship screen

const PRONOUN_LABEL = { she: 'she/her', he: 'he/him', they: 'they/them' } as const;
export type ShipTab = 'journal' | 'crew' | 'ship' | 'log';
const TABS: { id: ShipTab; label: string }[] = [
  { id: 'journal', label: 'Journal' },
  { id: 'crew', label: 'Crew' },
  { id: 'ship', label: 'Ship' },
  { id: 'log', label: 'Log' },
];

/** True if anyone aboard has something new to talk about. */
export function crewHasNews(state: GameState): boolean {
  return state.crew.some((id) => crewTalks(id, gameData.dialogues, state).length > 0);
}

/**
 * Your ship and everything aboard, in tabs: the mission journal, your crew
 * (talk to them, Mass Effect-style), the ship itself, and the story log.
 * Opens on Crew when someone wants a word.
 */
export function renderShip(card: HTMLDivElement, session: Session, close: () => void, start?: ShipTab): void {
  let tab: ShipTab = start ?? (crewHasNews(session.state) ? 'crew' : 'journal');
  const draw = (): void => {
    const state = session.state;
    card.replaceChildren(el('h1', '', state.shipName), el('div', 'sub', `${state.captain ? `Captain ${state.captain.name} · ` : ''}${credits(state.credits)}`));
    const bar = el('div', 'tabs');
    for (const t of TABS) {
      const cls = [t.id === tab ? 'primary' : '', t.id === 'crew' && t.id !== tab && crewHasNews(state) ? 'dot' : ''].filter(Boolean).join(' ');
      bar.append(
        button(t.label, () => {
          tab = t.id;
          draw();
        }, cls),
      );
    }
    card.append(bar);
    const body = el('div', 'tab-body');
    if (tab === 'journal') journalTab(body, state);
    else if (tab === 'crew') crewTab(body, session, card, draw);
    else if (tab === 'ship') shipTab(body, session, card);
    else logTab(body, state);
    card.append(body);
    const done = button('Close', close, 'primary');
    done.style.width = '100%';
    done.style.marginTop = '12px';
    card.append(done);
  };
  draw();
}

/** Where a target is, in words: "Archive Halls · 61 Cygni (3 jumps)". */
export function targetText(target: Target, state: GameState): string {
  const sys = gameData.systems.get(target.system)?.name ?? target.system;
  const place = target.poi !== undefined ? gameData.pois.get(target.poi)?.name : target.site !== undefined ? gameData.sites.get(target.site)?.site.name : undefined;
  const route = routeTo(state.systemId, target.system, gameData);
  const jumps = route ? route.length - 1 : 0;
  const far = jumps === 0 ? 'this system' : `${jumps} jump${jumps === 1 ? '' : 's'}`;
  return `${place ? `${place} · ` : ''}${sys} (${far})`;
}

function journalTab(body: HTMLElement, state: GameState): void {
  const all = journal(state, gameData);
  if (all.length === 0) {
    body.append(el('p', '', 'No missions yet. Talk to people in bars and ports. Someone always needs a captain with a ship like yours.'));
    return;
  }
  const kindLabel = { main: 'Main story', companion: 'Crew', side: 'Side story' } as const;
  for (const p of all) {
    const m = p.mission;
    const row = el('div', p.done ? 'svc mission done' : 'svc mission', el('b', '', m.title), el('span', 'sub', `  ·  ${p.done ? 'Complete' : kindLabel[m.kind]}`));
    if (!p.done) {
      row.append(el('div', 'svc-note', m.summary));
      for (const s of m.steps.slice(0, p.step)) row.append(el('div', 'step-done', s.text));
      const now = m.steps[p.step];
      if (now) {
        row.append(el('div', 'svc-note step-now', `◆ ${now.text}`));
        if (now.target) row.append(el('div', 'sub', targetText(now.target, state)));
      }
    }
    body.append(row);
  }
}

function crewTab(body: HTMLElement, session: Session, card: HTMLDivElement, redraw: () => void): void {
  const state = session.state;
  if (state.crew.length === 0) body.append(el('p', '', "It's just you aboard for now. People you meet on your travels may ask to come along."));
  for (const id of state.crew) {
    const who = gameData.characters.get(id);
    if (!who) continue;
    const face = el('div', 'portrait-box');
    setSvg(face, portraitSvg(who.look));
    const talks = crewTalks(id, gameData.dialogues, state);
    const first = talks[0];
    const talk = button(first ? 'Talk' : 'Nothing new', () => {
      if (!first) return;
      openSheet(card.closest('.layer') ?? card, (sheet, closeSheet) => {
        renderDialogue(sheet, session, first.id, () => {
          closeSheet();
          redraw();
        });
      });
    }, first ? 'primary small dot' : 'small');
    talk.disabled = !first;
    let armed = false;
    const leave = button('Ask to leave', () => {
      if (!armed) {
        armed = true;
        leave.textContent = 'Tap again to confirm';
        return;
      }
      const home = who.home === undefined ? undefined : gameData.sites.get(who.home)?.site.name;
      if (session.dismiss(id, Date.now())) showToast(`${who.name.split(' ')[0]} will wait at ${home ?? 'their home port'}`);
      redraw();
    }, 'small');
    const info = el(
      'div',
      '',
      el('b', '', who.name),
      el('span', 'sub', `  ·  ${PRONOUN_LABEL[who.pronouns]}`),
      el('div', 'sub', `${who.role} · ${feelingWord(state.affinity[id] ?? 0)}`),
      el('div', 'svc-note', who.bio),
      el('div', 'row', talk, leave),
    );
    body.append(el('div', 'svc crew-row', face, info));
  }
  const away = [...gameData.characters.values()].filter((c) => !state.crew.includes(c.id) && state.flags.includes(`joined-${c.id}`));
  if (away.length > 0) {
    body.append(el('div', 'sub section', 'Waiting ashore'));
    for (const c of away) {
      const where = c.home === undefined ? undefined : gameData.sites.get(c.home);
      body.append(el('div', 'svc svc-dim', el('b', '', c.name), el('div', 'svc-note', `At ${where?.site.name ?? '?'}, ${gameData.systems.get(where?.systemId ?? '')?.name ?? ''}. Land there to invite them back.`)));
    }
  }
}

function shipTab(body: HTMLElement, session: Session, card: HTMLDivElement): void {
  const state = session.state;
  const def = gameData.ships.get(state.ship.defId);
  const stats = statsFor(state, gameData);
  const art = el('div', 'ship-box');
  setSvg(art, shipSvg(state.paint));
  body.append(el('div', 'sub', def?.name ?? ''), art, el('div', 'note', 'Repaint her at any drydock: Highport, Olympus Yards, Centauri Yards or Sirius Gate.'));
  const cap = state.captain;
  if (cap) {
    const portrait = el('div', 'portrait-box small');
    setSvg(portrait, portraitSvg(cap.look));
    const changeLook = button('Change look', () => {
      openSheet(card.closest('.layer') ?? card, (sheet, close) => {
        const look = { ...cap.look };
        sheet.append(el('h1', '', 'Change look'), el('div', 'sub', `Captain ${cap.name}`), lookEditor(look));
        const save = button('Save', () => {
          if (session.setLook(look, Date.now())) {
            setSvg(portrait, portraitSvg(look));
            showToast('Looking sharp, captain');
          }
          close();
        }, 'primary');
        sheet.append(el('div', 'row nav-row', button('Cancel', close), save));
      });
    }, 'small');
    body.append(el('div', 'row look-row', portrait, changeLook));
    const c = gameData.creation;
    const origin = c.origins.find((o) => o.id === cap.origin)?.name ?? '';
    const moment = c.moments.find((m) => m.id === cap.moment)?.name ?? '';
    const motive = c.motives.find((m) => m.id === cap.motive)?.name ?? '';
    body.append(el('div', 'svc', el('b', '', `Captain ${cap.name}`), el('span', 'sub', `  ·  ${PRONOUN_LABEL[cap.pronouns]}`), el('div', 'svc-note', [origin, moment, motive].filter(Boolean).join(' · '))));
  }

  const rows: [string, string][] = [
    ['Thrust', String(Math.round(stats.thrust))],
    ['Top speed', String(Math.round(stats.maxSpeed))],
    ['Turning', stats.turnRate.toFixed(1)],
    ['Cruise', `×${stats.cruiseMultiplier}`],
    ['Hold', `${cargoUsed(state)} / ${stats.cargo}`],
    ['Hull', String(stats.hull)],
    ['Shields', String(stats.shields)],
    ['Credits', credits(state.credits)],
  ];
  const grid = el('div', 'stat-grid');
  for (const [k, v] of rows) grid.append(el('div', 'stat', el('span', 'sub', k), el('b', '', v)));
  body.append(el('div', 'sub section', 'Ship'), grid);

  const ups = gameData.upgrades
    .filter((t) => (state.upgrades[t.id] ?? 0) > 0)
    .map((t) => `${t.name}: ${t.tiers[(state.upgrades[t.id] ?? 1) - 1]?.name ?? ''}`);
  body.append(el('div', 'sub section', 'Upgrades'), el('p', '', ups.length > 0 ? ups.join(' · ') : 'Stock. Drydocks at Highport, Olympus Yards, Centauri Yards and Sirius Gate can upgrade her.'));

  const hold = Object.entries(state.cargo).map(([id, n]) => `${gameData.commodities.get(id)?.name ?? id} ×${n}`);
  body.append(el('div', 'sub section', 'Cargo hold'), el('p', '', hold.length > 0 ? hold.join(' · ') : 'Empty.'));

  body.append(el('div', 'sub section', 'Locker'));
  const locker = Object.entries(state.locker);
  if (locker.length === 0) body.append(el('p', '', 'Empty for now. Mission items, artifacts and things you discover go here, and it never fills up.'));
  for (const [id, n] of locker) {
    const item = gameData.items.get(id);
    body.append(el('div', 'svc', el('b', '', `${item?.name ?? id}${n > 1 ? ` ×${n}` : ''}`), el('div', 'svc-note', item?.description ?? '')));
  }
}

function logTab(body: HTMLElement, state: GameState): void {
  // Story log: what you've learned, newest first.
  const entries = gameData.log.filter((e) => state.flags.includes(e.flag)).sort((a, b) => state.flags.indexOf(b.flag) - state.flags.indexOf(a.flag));
  if (entries.length === 0) body.append(el('p', '', 'Nothing yet. Talk to people, follow signals, and what you learn will be written here.'));
  for (const e of entries) body.append(el('div', 'svc log-entry', el('b', '', e.title), el('div', 'svc-note', e.text)));
}

// ------------------------------------------------------------------ Conversation

/**
 * Small notices for what a choice changed: someone's approval, who came
 * aboard or left, new journal entries. Approval is shown as a feeling, never
 * a number, and only for people you know (characters with a name card).
 */
export function storyNotices(before: GameState, after: GameState): string[] {
  const out: string[] = [];
  const name = (id: string): string => gameData.characters.get(id)?.name.split(' ')[0] ?? id;
  for (const id of Object.keys(after.affinity)) {
    const d = (after.affinity[id] ?? 0) - (before.affinity[id] ?? 0);
    if (d > 0) out.push(`${name(id)} liked that`);
    if (d < 0) out.push(`${name(id)} didn't like that`);
  }
  for (const id of after.crew) if (!before.crew.includes(id)) out.push(`${name(id)} joined the crew`);
  for (const id of before.crew) if (!after.crew.includes(id)) out.push(`${name(id)} left the ship`);
  const had = new Set(journal(before, gameData).map((p) => `${p.mission.id}:${p.done}`));
  for (const p of journal(after, gameData)) {
    if (had.has(`${p.mission.id}:${p.done}`)) continue;
    out.push(p.done ? `Mission complete: ${p.mission.title}` : `New mission: ${p.mission.title}`);
  }
  for (const e of gameData.log) if (after.flags.includes(e.flag) && !before.flags.includes(e.flag)) out.push(`Log: ${e.title}`);
  return out;
}

/** Show notices one after another (toasts replace each other, so space them out). */
export function showNotices(notices: readonly string[]): void {
  notices.forEach((n, i) => {
    setTimeout(() => {
      showToast(n, 1800);
    }, i * 1900);
  });
}

/** A branching conversation as a sheet: speaker, portrait, text, choices (background-unlocked highlighted, flirts with a heart). */
export function renderDialogue(card: HTMLDivElement, session: Session, dialogueId: string, close: () => void): void {
  const d = gameData.dialogues.get(dialogueId);
  if (!d) {
    close();
    return;
  }
  const who = d.character === undefined ? undefined : gameData.characters.get(d.character);
  const pending: string[] = [];
  const finish = (): void => {
    close();
    showNotices(pending);
  };
  const draw = (nodeId: string): void => {
    const node = d.nodes[nodeId];
    card.classList.toggle('mood-fade', node?.mood === 'fade');
    card.classList.toggle('mood-title', node?.mood === 'title');
    const head = el('div', 'dialogue-head');
    if (who) {
      const face = el('div', 'portrait-box tiny');
      setSvg(face, portraitSvg(who.look));
      head.append(face);
    }
    head.append(el('div', '', el('h1', '', d.speaker), el('div', 'sub', d.role)));
    const story = el('div', 'dialogue-story', head, el('p', 'dialogue-text', nodeText(d, nodeId, session.state)));
    const options = el('div', 'dialogue-choices');
    card.classList.add('dialogue');
    card.replaceChildren(story, options);
    for (const choice of shownChoices(d, nodeId, session.state)) {
      const b = button(choice.flirt ? `♥ ${choice.text}` : choice.text, () => {
        const before = session.state;
        const r = session.talk(d.id, nodeId, choice.index, Date.now());
        if (!r.ok) return;
        pending.push(...storyNotices(before, session.state));
        if (r.next === null) finish();
        else draw(r.next);
      }, choice.flirt ? 'pick special flirt' : choice.special ? 'pick special' : 'pick');
      options.append(b);
    }
    card.scrollTop = 0;
    story.scrollTop = 0;
    options.scrollTop = 0;
  };
  draw(d.start);
}

// ------------------------------------------------------------------ Paint shop

const REPAINT_TEXT = { 'no-drydock': 'Needs a drydock', credits: 'Not enough credits', unchanged: 'No changes yet', invalid: 'Invalid paint' } as const;

/** Repaint editor inside the drydock sheet. Applying charges the repaint cost. */
export function renderPaintShop(card: HTMLDivElement, session: Session, back: () => void): void {
  const paint = { ...session.state.paint };
  const apply = button('', () => {
    const r = session.repaintShip(paint, Date.now());
    if (r.ok) {
      showToast(`${session.state.shipName} repainted`);
      back();
    } else showToast(REPAINT_TEXT[r.reason]);
  }, 'primary');
  const update = (): void => {
    const check = canRepaint(session.state, paint, gameData);
    apply.disabled = !check.ok;
    apply.textContent = check.ok ? `Apply · ${credits(check.cost)}` : REPAINT_TEXT[check.reason];
  };
  card.replaceChildren(
    el('h1', '', 'Paint shop'),
    el('div', 'sub', `${session.state.shipName} · ${credits(session.state.credits)}`),
    paintEditor(paint, update),
    el('div', 'row nav-row', button('Back', back), apply),
  );
  update();
}

// ------------------------------------------------------------------ Look & paint editors (shared)

/** An option row that rebuilds only itself on pick (no jump back to the top on a phone). */
function optionRow(label: string, build: (refresh: () => void) => HTMLElement, onChange: () => void): HTMLElement {
  const slot = el('div');
  const refresh = (): void => {
    slot.replaceChildren(build(refresh));
    onChange();
  };
  slot.append(build(refresh));
  return el('div', 'opt-row', el('div', 'sub section', label), slot);
}

/** Captain portrait editor: live preview, "Surprise me", and every option. Edits `look` in place. */
export function lookEditor(look: Look, onChange: () => void = () => undefined): HTMLDivElement {
  const a = gameData.appearance.captain;
  const root = el('div', 'look-grid');
  const build = (): void => {
    const preview = el('div', 'portrait-box');
    const update = (): void => {
      setSvg(preview, portraitSvg(look));
      onChange();
    };
    setSvg(preview, portraitSvg(look));
    const randomize = button('Surprise me', () => {
      const rng = new Rng(freshSeed());
      look.face = rng.pick(a.faces).id;
      look.skin = rng.pick(a.skinTones);
      look.hair = rng.pick(a.hairStyles).id;
      look.hairColor = rng.pick(a.hairColors);
      look.eyes = rng.pick(a.eyeColors);
      look.outfit = rng.pick(a.outfits).id;
      look.outfitColor = rng.pick(a.outfitColors);
      look.beard = rng.pick(a.beards).id;
      build();
      onChange();
    }, 'small');
    root.replaceChildren(
      el('div', 'look-preview', preview, randomize),
      el(
        'div',
        'look-options',
        optionRow('Face', (r) => chips(a.faces, look.face, (v) => { look.face = v; r(); }), update),
        optionRow('Skin', (r) => swatches(a.skinTones, look.skin, (v) => { look.skin = v; r(); }, 'Skin tone'), update),
        optionRow('Hair', (r) => chips(a.hairStyles, look.hair, (v) => { look.hair = v; r(); }), update),
        optionRow('Hair color', (r) => swatches(a.hairColors, look.hairColor, (v) => { look.hairColor = v; r(); }, 'Hair color'), update),
        optionRow('Facial hair', (r) => chips(a.beards, look.beard, (v) => { look.beard = v; r(); }), update),
        optionRow('Eyes', (r) => swatches(a.eyeColors, look.eyes, (v) => { look.eyes = v; r(); }, 'Eye color'), update),
        optionRow('Outfit', (r) => chips(a.outfits, look.outfit, (v) => { look.outfit = v; r(); }), update),
        optionRow('Outfit color', (r) => swatches(a.outfitColors, look.outfitColor, (v) => { look.outfitColor = v; r(); }, 'Outfit color'), update),
      ),
    );
  };
  build();
  return root;
}

/** Ship paint editor: big live preview and every option. Edits `paint` in place. */
export function paintEditor(paint: Paint, onChange: () => void = () => undefined): HTMLDivElement {
  const a = gameData.appearance.ship;
  const preview = el('div', 'ship-box big');
  const update = (): void => {
    setSvg(preview, shipSvg(paint));
    onChange();
  };
  setSvg(preview, shipSvg(paint));
  return el(
    'div',
    'look-grid',
    el('div', 'look-preview', preview),
    el(
      'div',
      'look-options',
      optionRow('Hull', (r) => swatches(a.hullColors, paint.hull, (v) => { paint.hull = v; r(); }, 'Hull color'), update),
      optionRow('Accent', (r) => swatches(a.accentColors, paint.accent, (v) => { paint.accent = v; r(); }, 'Accent color'), update),
      optionRow('Pattern', (r) => chips(a.patterns, paint.pattern, (v) => { paint.pattern = v; r(); }), update),
      optionRow('Engine glow', (r) => swatches(a.glowColors, paint.glow, (v) => { paint.glow = v; r(); }, 'Engine glow'), update),
    ),
  );
}
