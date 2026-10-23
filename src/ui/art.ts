/**
 * Generated art for the captain's portrait and the ship's paint job, as SVG.
 * One source for both the menus (inline SVG) and flight (the same SVG turned
 * into a Phaser texture), so what you design is exactly what you fly.
 *
 * Inputs are validated content values (hex colors, option ids), never free
 * text, so building markup from them is safe.
 */
import type { Look, Paint } from '../core/state';

const HEX = /^#[0-9a-fA-F]{6}$/;
function color(c: string, fallback: string): string {
  return HEX.test(c) ? c : fallback;
}

function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number): string => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

let uid = 0;

// ------------------------------------------------------------------ captain portrait

const FACES: Record<string, { rx: number; ry: number; jaw: number }> = {
  oval: { rx: 21, ry: 27, jaw: 0 },
  round: { rx: 24, ry: 25, jaw: 0 },
  square: { rx: 23, ry: 26, jaw: 7 },
  narrow: { rx: 19, ry: 28, jaw: 0 },
};

/** Captain portrait (viewBox 120×140). */
export function portraitSvg(look: Look): string {
  const skin = color(look.skin, '#c08559');
  const hair = color(look.hairColor, '#3b2416');
  const eyes = color(look.eyes, '#6b4a2b');
  const cloth = color(look.outfitColor, '#2b3a55');
  const face = FACES[look.face] ?? { rx: 21, ry: 27, jaw: 0 };
  const cx = 60;
  const cy = 62;
  const top = cy - face.ry;

  // Hair drawn behind the head (long styles, afro, locs, bun).
  const L = cx - face.rx;
  const R = cx + face.rx;
  let back: string;
  switch (look.hair) {
    case 'long':
      back = `<path d="M${L - 5} ${cy - 6} Q${L - 8} ${cy + 40} ${cx - 16} ${cy + 46} L${cx + 16} ${cy + 46} Q${R + 8} ${cy + 40} ${R + 5} ${cy - 6} Z" fill="${hair}"/>`;
      break;
    case 'ponytail':
      back = `<path d="M${R - 2} ${cy - 10} Q${R + 18} ${cy + 4} ${R + 8} ${cy + 34} Q${R + 2} ${cy + 14} ${R - 6} ${cy + 2} Z" fill="${hair}"/>`;
      break;
    case 'bun':
      back = `<circle cx="${cx}" cy="${top - 4}" r="11" fill="${hair}"/>`;
      break;
    case 'topknot':
      back = `<circle cx="${cx}" cy="${top - 5}" r="8" fill="${hair}"/>`;
      break;
    case 'afro':
      back = `<ellipse cx="${cx}" cy="${top + 12}" rx="${face.rx + 15}" ry="${face.ry + 4}" fill="${hair}"/>`;
      break;
    case 'locs':
      // Rope-like locs falling past the shoulders on both sides.
      back = [-1, 1]
        .map((side) =>
          [0, 1, 2, 3]
            .map((i) => {
              const x = cx + side * (face.rx - 4 + i * 4.5);
              const len = face.ry + 26 + (i % 2) * 8;
              return `<path d="M${x} ${top + 6} Q${x + side * 3} ${cy + 10} ${x + side * 1} ${top + 6 + len}" stroke="${shade(hair, i % 2 ? 0.8 : 1)}" stroke-width="5.5" stroke-linecap="round" fill="none"/>`;
            })
            .join(''),
        )
        .join('');
      break;
    default:
      back = '';
  }

  // Outfit (shoulders) by style.
  const shoulders = `M14 140 Q16 104 ${cx - 22} 98 L${cx + 22} 98 Q104 104 106 140 Z`;
  let outfit = `<path d="${shoulders}" fill="${cloth}"/>`;
  if (look.outfit === 'flight-jacket') {
    outfit += `<path d="M${cx - 14} 98 L${cx} 120 L${cx + 14} 98 Z" fill="${shade(cloth, 0.6)}"/><path d="M${cx - 22} 98 L${cx - 12} 112 L${cx - 30} 108 Z M${cx + 22} 98 L${cx + 12} 112 L${cx + 30} 108 Z" fill="${shade(cloth, 1.35)}"/>`;
  } else if (look.outfit === 'uniform') {
    outfit += `<path d="M${cx - 10} 98 L${cx} 104 L${cx + 10} 98 L${cx + 10} 140 L${cx - 10} 140 Z" fill="${shade(cloth, 0.7)}"/><rect x="${cx - 38}" y="104" width="14" height="4" rx="2" fill="#ffd27a"/><rect x="${cx + 24}" y="104" width="14" height="4" rx="2" fill="#ffd27a"/>`;
  } else if (look.outfit === 'mechanic') {
    outfit += `<rect x="${cx - 30}" y="112" width="12" height="28" fill="${shade(cloth, 0.8)}"/><rect x="${cx + 18}" y="112" width="12" height="28" fill="${shade(cloth, 0.8)}"/><circle cx="${cx - 24}" cy="118" r="2" fill="#c9ccd2"/><circle cx="${cx + 24}" cy="118" r="2" fill="#c9ccd2"/>`;
  } else if (look.outfit === 'longcoat') {
    outfit += `<path d="M${cx - 22} 98 L${cx - 6} 140 L${cx - 18} 140 L${cx - 30} 102 Z M${cx + 22} 98 L${cx + 6} 140 L${cx + 18} 140 L${cx + 30} 102 Z" fill="${shade(cloth, 1.3)}"/><path d="M${cx - 9} 98 L${cx + 9} 98 L${cx + 6} 110 L${cx - 6} 110 Z" fill="${shade(cloth, 0.55)}"/>`;
  }

  const neck = `<rect x="${cx - 9}" y="${cy + face.ry - 8}" width="18" height="18" fill="${shade(skin, 0.88)}"/>`;
  const head = face.jaw > 0
    ? `<path d="M${cx - face.rx} ${cy - 8} Q${cx - face.rx} ${top} ${cx} ${top} Q${cx + face.rx} ${top} ${cx + face.rx} ${cy - 8} L${cx + face.rx - 2} ${cy + 12} Q${cx + face.rx - face.jaw} ${cy + face.ry} ${cx} ${cy + face.ry} Q${cx - face.rx + face.jaw} ${cy + face.ry} ${cx - face.rx + 2} ${cy + 12} Z" fill="${skin}"/>`
    : `<ellipse cx="${cx}" cy="${cy}" rx="${face.rx}" ry="${face.ry}" fill="${skin}"/>`;
  const ears = `<ellipse cx="${cx - face.rx}" cy="${cy + 2}" rx="4" ry="6" fill="${shade(skin, 0.92)}"/><ellipse cx="${cx + face.rx}" cy="${cy + 2}" rx="4" ry="6" fill="${shade(skin, 0.92)}"/>`;
  const eyeY = cy - 2;
  const eyeRow = [-9, 9]
    .map((dx) => `<ellipse cx="${cx + dx}" cy="${eyeY}" rx="4.5" ry="3" fill="#f6f3ee"/><circle cx="${cx + dx}" cy="${eyeY}" r="2.3" fill="${eyes}"/><circle cx="${cx + dx}" cy="${eyeY}" r="1" fill="#111"/>`)
    .join('');
  const brows = `<path d="M${cx - 14} ${eyeY - 7} Q${cx - 9} ${eyeY - 10} ${cx - 4} ${eyeY - 7}" stroke="${shade(hair, 0.9)}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M${cx + 4} ${eyeY - 7} Q${cx + 9} ${eyeY - 10} ${cx + 14} ${eyeY - 7}" stroke="${shade(hair, 0.9)}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const nose = `<path d="M${cx} ${eyeY + 3} L${cx - 3} ${eyeY + 12} L${cx + 2} ${eyeY + 13}" stroke="${shade(skin, 0.72)}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const mouth = `<path d="M${cx - 7} ${eyeY + 20} Q${cx} ${eyeY + 24} ${cx + 7} ${eyeY + 20}" stroke="${shade(skin, 0.55)}" stroke-width="2" fill="none" stroke-linecap="round"/>`;

  // A close-fitting cap of hair: outer edge `lift` above the skull, hairline `hl` below the top of the head.
  const cap = (lift: number, hl: number, fill = hair, extra = ''): string =>
    `<path d="M${L - 1} ${cy - 4} Q${L - 1} ${top - lift} ${cx} ${top - lift} Q${R + 1} ${top - lift} ${R + 1} ${cy - 4} L${R - 1} ${cy - 9} Q${R - 2} ${top + hl} ${cx} ${top + hl} Q${L + 2} ${top + hl} ${L + 1} ${cy - 9} Z" fill="${fill}" ${extra}/>`;
  const sideburns = `<rect x="${L - 1}" y="${cy - 10}" width="4" height="12" rx="1.5" fill="${hair}"/><rect x="${R - 3}" y="${cy - 10}" width="4" height="12" rx="1.5" fill="${hair}"/>`;

  // Hair on top of the head.
  let front: string;
  switch (look.hair) {
    case 'short':
    case 'long':
    case 'ponytail':
    case 'bun':
      // Side-swept bangs.
      front = `<path d="M${L - 2} ${cy - 4} Q${L - 2} ${top - 6} ${cx} ${top - 6} Q${R + 2} ${top - 6} ${R + 2} ${cy - 4} Q${R - 4} ${top + 8} ${cx + 4} ${top + 9} Q${cx - 10} ${top + 12} ${L + 3} ${cy - 2} Z" fill="${hair}"/>`;
      break;
    case 'crew':
      front = cap(3, 7) + sideburns;
      break;
    case 'sidepart':
      front = `${cap(6, 9)}${sideburns}<path d="M${cx - 7} ${top - 5} Q${cx - 6} ${top + 2} ${cx - 8} ${top + 8}" stroke="${shade(hair, 0.6)}" stroke-width="1.5" fill="none"/><path d="M${cx - 7} ${top - 5} Q${cx + 10} ${top - 10} ${R + 1} ${top + 4} Q${cx + 8} ${top - 2} ${cx - 7} ${top + 1} Z" fill="${shade(hair, 1.15)}"/>`;
      break;
    case 'slick':
      front = `${cap(5, 6)}${sideburns}<path d="M${cx - 12} ${top - 1} Q${cx} ${top - 6} ${cx + 12} ${top - 1}" stroke="${shade(hair, 1.6)}" stroke-width="1.5" fill="none" opacity="0.6"/><path d="M${cx - 8} ${top + 3} Q${cx} ${top - 1} ${cx + 8} ${top + 3}" stroke="${shade(hair, 1.6)}" stroke-width="1.2" fill="none" opacity="0.45"/>`;
      break;
    case 'quiff':
      front = `${cap(4, 9)}${sideburns}<path d="M${L + 2} ${top + 4} Q${cx - 8} ${top - 11} ${cx + 8} ${top - 10} Q${R + 4} ${top - 7} ${R} ${top + 5} Q${cx + 4} ${top} ${L + 2} ${top + 4} Z" fill="${hair}"/><path d="M${cx - 6} ${top - 5} Q${cx + 4} ${top - 9} ${R - 3} ${top - 2}" stroke="${shade(hair, 1.5)}" stroke-width="1.2" fill="none" opacity="0.5"/>`;
      break;
    case 'messy': {
      // Tousled: overlapping tufts of different sizes along the top, leaning one way.
      const tufts = [
        [-17, 6, 6], [-11, 1, 7], [-4, -2, 7], [3, -2, 7], [10, 0, 7], [16, 4, 6], [-1, 3, 6], [7, 4, 5],
      ]
        .map(([dx = 0, dy = 0, r = 6]) => `<ellipse cx="${cx + dx}" cy="${top + dy}" rx="${r}" ry="${r - 2}" transform="rotate(-18 ${cx + dx} ${top + dy})" fill="${hair}"/>`)
        .join('');
      front = `${cap(3, 9)}${sideburns}${tufts}`;
      break;
    }
    case 'fade':
      // Full on top, faded on the sides.
      front = `${cap(2, 8, hair, 'opacity="0.35"')}<path d="M${L + 6} ${top + 6} Q${L + 6} ${top - 7} ${cx} ${top - 7} Q${R - 6} ${top - 7} ${R - 6} ${top + 6} Q${cx} ${top + 9} ${L + 6} ${top + 6} Z" fill="${hair}"/>`;
      break;
    case 'buzz':
      front = cap(1, 6, hair, 'opacity="0.8"');
      break;
    case 'afro':
      front = cap(6, 9);
      break;
    case 'locs':
    case 'topknot':
      front = cap(3, 8);
      break;
    case 'curls':
      front = Array.from({ length: 9 }, (_, i) => {
        const ang = Math.PI + (i / 8) * Math.PI;
        return `<circle cx="${(cx + Math.cos(ang) * (face.rx + 1)).toFixed(1)}" cy="${(cy - 6 + Math.sin(ang) * (face.ry - 2)).toFixed(1)}" r="8" fill="${hair}"/>`;
      }).join('');
      break;
    case 'undercut':
      front = `<path d="M${L + 2} ${cy - 10} Q${cx - 6} ${top - 10} ${R + 4} ${top + 2} Q${R + 2} ${top + 10} ${R - 2} ${cy - 10} Q${cx} ${top + 4} ${L + 2} ${cy - 10} Z" fill="${hair}"/>`;
      break;
    default:
      front = '';
  }

  // Facial hair (drawn over the face; the mouth is redrawn on top so it stays readable).
  const jawFill = (opacity: number): string =>
    `<path d="M${L + 1} ${cy + 1} Q${L + 2} ${cy + face.ry + 3} ${cx} ${cy + face.ry + 4} Q${R - 2} ${cy + face.ry + 3} ${R - 1} ${cy + 1} L${R - 5} ${cy + 4} Q${cx + 6} ${eyeY + 13} ${cx} ${eyeY + 14} Q${cx - 6} ${eyeY + 13} ${L + 5} ${cy + 4} Z" fill="${hair}" opacity="${opacity}"/>`;
  const stache = `<path d="M${cx - 9} ${eyeY + 18} Q${cx - 4} ${eyeY + 13} ${cx} ${eyeY + 16} Q${cx + 4} ${eyeY + 13} ${cx + 9} ${eyeY + 18} Q${cx} ${eyeY + 17} ${cx - 9} ${eyeY + 18} Z" fill="${hair}"/>`;
  let beard: string;
  switch (look.beard) {
    case 'stubble':
      beard = jawFill(0.3);
      break;
    case 'mustache':
      beard = stache;
      break;
    case 'goatee':
      beard = `${stache}<path d="M${cx - 7} ${eyeY + 22} Q${cx} ${eyeY + 34} ${cx + 7} ${eyeY + 22} Q${cx} ${eyeY + 25} ${cx - 7} ${eyeY + 22} Z" fill="${hair}"/>`;
      break;
    case 'short-beard':
      beard = `${jawFill(0.92)}${stache}`;
      break;
    case 'full-beard':
      beard = `${jawFill(1)}<path d="M${L + 3} ${cy + 10} Q${cx} ${cy + face.ry + 16} ${R - 3} ${cy + 10} Q${cx} ${cy + face.ry + 6} ${L + 3} ${cy + 10} Z" fill="${hair}"/>${stache}`;
      break;
    default:
      beard = '';
  }
  const lips = beard === '' ? mouth : `<path d="M${cx - 6} ${eyeY + 20} Q${cx} ${eyeY + 23} ${cx + 6} ${eyeY + 20}" stroke="${shade(skin, 0.7)}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" class="portrait" role="img" aria-label="Captain portrait"><rect width="120" height="140" rx="16" fill="#141b2c"/><circle cx="60" cy="58" r="52" fill="#1c2640"/>${back}${outfit}${neck}${ears}${head}${eyeRow}${brows}${nose}${beard}${lips}${front}</svg>`;
}

// ------------------------------------------------------------------ ship

/** Your ship, pointing right (viewBox 72×56). Used inline and as the flight texture. */
export function shipSvg(paint: Paint): string {
  const id = `hull${uid++}`;
  const hull = color(paint.hull, '#dfe8ff');
  const accent = color(paint.accent, '#4fc3ff');
  const glow = color(paint.glow, '#ffa040');
  const body = 'M70 28 L48 19 L24 17 L6 21 L6 35 L24 39 L48 37 Z';
  const wings = 'M42 22 L22 3 L13 3 L23 20 Z M42 34 L22 53 L13 53 L23 36 Z';
  let pattern: string;
  switch (paint.pattern) {
    case 'stripe':
      pattern = `<rect x="8" y="25.5" width="58" height="5" fill="${accent}"/>`;
      break;
    case 'split':
      pattern = `<rect x="0" y="0" width="72" height="28" fill="${accent}" opacity="0.85"/>`;
      break;
    case 'tips':
      pattern = `<path d="M22 3 L13 3 L16.5 8.5 L26 8.5 Z M22 53 L13 53 L16.5 47.5 L26 47.5 Z" fill="${accent}"/><rect x="6" y="21" width="5" height="14" fill="${accent}"/>`;
      break;
    case 'chevron':
      pattern = `<path d="M54 20 L42 28 L54 36" stroke="${accent}" stroke-width="4" fill="none"/><path d="M38 18 L26 28 L38 38" stroke="${accent}" stroke-width="4" fill="none"/>`;
      break;
    default:
      pattern = '';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 56" width="144" height="112" class="ship-art" role="img" aria-label="Your ship"><defs><clipPath id="${id}"><path d="${body} ${wings}"/></clipPath></defs><rect x="1" y="21.5" width="6" height="5" rx="1" fill="${glow}"/><rect x="1" y="29.5" width="6" height="5" rx="1" fill="${glow}"/><path d="${wings}" fill="${shade(hull, 0.82)}"/><path d="${body}" fill="${hull}"/><g clip-path="url(#${id})">${pattern}</g><path d="${body} ${wings}" fill="none" stroke="${shade(hull, 0.55)}" stroke-width="1"/><ellipse cx="53" cy="28" rx="7" ry="3.6" fill="#16263a" stroke="${accent}" stroke-width="1"/></svg>`;
}

/** Stable key for a paint job, used to cache the flight texture. */
export function paintKey(paint: Paint): string {
  return `ship-${paint.hull}-${paint.accent}-${paint.pattern}-${paint.glow}`.replaceAll('#', '');
}

/** SVG as a base64 data URI (for turning into a game texture). The markup is ASCII. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** Insert generated SVG markup into a container element. */
export function setSvg(container: HTMLElement, svg: string): void {
  container.innerHTML = svg;
}
