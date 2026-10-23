/**
 * Port panels (Market, Drydock) and the ship summary. Plain DOM built from
 * game state; every action goes through the Session (which saves), then the
 * panel re-renders itself. Shown as a sheet over the port screen.
 */
import { gameData, type UpgradeEffect } from '../data/schema';
import type { Session } from '../core/session';
import { cargoUsed, holdSize, maxBuyable, quote, tradeBlockText } from '../systems/market';
import { canUpgrade, statsFor, upgradeBlockText } from '../systems/ship';
import { button, credits, el } from './dom';
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

// ------------------------------------------------------------------ Ship summary

const PRONOUN_LABEL = { she: 'she/her', he: 'he/him', they: 'they/them' } as const;

export function renderShip(card: HTMLDivElement, session: Session, close: () => void): void {
  const state = session.state;
  const def = gameData.ships.get(state.ship.defId);
  const stats = statsFor(state, gameData);
  card.append(el('h1', '', state.shipName), el('div', 'sub', def?.name ?? ''));

  const cap = state.captain;
  if (cap) {
    const c = gameData.creation;
    const origin = c.origins.find((o) => o.id === cap.origin)?.name ?? '';
    const moment = c.moments.find((m) => m.id === cap.moment)?.name ?? '';
    const motive = c.motives.find((m) => m.id === cap.motive)?.name ?? '';
    card.append(el('div', 'svc', el('b', '', `Captain ${cap.name}`), el('span', 'sub', `  ·  ${PRONOUN_LABEL[cap.pronouns]}`), el('div', 'svc-note', [origin, moment, motive].filter(Boolean).join(' · '))));
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
  card.append(el('div', 'sub section', 'Ship'), grid);

  const ups = gameData.upgrades
    .filter((t) => (state.upgrades[t.id] ?? 0) > 0)
    .map((t) => `${t.name}: ${t.tiers[(state.upgrades[t.id] ?? 1) - 1]?.name ?? ''}`);
  card.append(el('div', 'sub section', 'Upgrades'), el('p', '', ups.length > 0 ? ups.join(' · ') : 'Stock. Drydocks at Highport, Olympus Yards, Centauri Yards and Sirius Gate can upgrade her.'));

  const hold = Object.entries(state.cargo).map(([id, n]) => `${gameData.commodities.get(id)?.name ?? id} ×${n}`);
  card.append(el('div', 'sub section', 'Cargo hold'), el('p', '', hold.length > 0 ? hold.join(' · ') : 'Empty.'));

  const locker = Object.entries(state.locker).map(([id, n]) => `${id} ×${n}`);
  card.append(
    el('div', 'sub section', 'Locker'),
    el('p', '', locker.length > 0 ? locker.join(' · ') : "Empty for now. Mission items, artifacts and things you discover go here, and it never fills up."),
  );
  const done = button('Close', close, 'primary');
  done.style.width = '100%';
  done.style.marginTop = '8px';
  card.append(done);
}
