/**
 * Small helpers for the DOM UI layer (#ui in index.html). Buttons and panels
 * are real HTML over the canvas: crisp text, real tap targets, accessible,
 * and CSS safe-area insets keep them clear of the notch and home bar.
 *
 * Each scene creates one Layer and destroys it on shutdown, so UI never
 * leaks between scenes.
 */
export interface Layer {
  root: HTMLDivElement;
  destroy: () => void;
}

export function createLayer(name: string): Layer {
  const host = document.getElementById('ui');
  const root = document.createElement('div');
  root.className = `layer layer-${name}`;
  host?.appendChild(root);
  return {
    root,
    destroy: () => {
      root.remove();
    },
  };
}

type Child = Node | string;

/** Create an element with a class and children (strings become text, never HTML). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children) node.append(c);
  return node;
}

/** A button that fires once per tap. Stops the event so it never reaches the game canvas. */
export function button(label: string, onTap: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!b.disabled) onTap();
  });
  // Keep touches on buttons from also starting the joystick underneath.
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  return b;
}

/** Credits with thousands separators and a "cr" suffix, e.g. "12,400 cr". */
export function credits(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} cr`;
}

/** A row of color swatches (44 pt tap targets); the selected one is outlined. */
export function swatches(colors: readonly string[], selected: string, onPick: (c: string) => void, label: string): HTMLDivElement {
  const row = el('div', 'swatches');
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  for (const c of colors) {
    const b = button('', () => {
      onPick(c);
    }, c === selected ? 'swatch on' : 'swatch');
    b.style.background = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c === selected));
    b.setAttribute('aria-label', `${label} ${c}`);
    row.append(b);
  }
  return row;
}

/** A row of named options as small buttons; the selected one is highlighted. */
export function chips(options: readonly { id: string; name: string }[], selected: string, onPick: (id: string) => void): HTMLDivElement {
  const row = el('div', 'row chips');
  for (const o of options) {
    row.append(
      button(o.name, () => {
        onPick(o.id);
      }, o.id === selected ? 'primary small' : 'small'),
    );
  }
  return row;
}
