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

  // Hair drawn behind the head (long styles).
  let back = '';
  if (look.hair === 'long') back = `<path d="M${cx - face.rx - 5} ${cy - 6} Q${cx - face.rx - 8} ${cy + 40} ${cx - 16} ${cy + 46} L${cx + 16} ${cy + 46} Q${cx + face.rx + 8} ${cy + 40} ${cx + face.rx + 5} ${cy - 6} Z" fill="${hair}"/>`;
  if (look.hair === 'ponytail') back = `<path d="M${cx + face.rx - 2} ${cy - 10} Q${cx + face.rx + 18} ${cy + 4} ${cx + face.rx + 8} ${cy + 34} Q${cx + face.rx + 2} ${cy + 14} ${cx + face.rx - 6} ${cy + 2} Z" fill="${hair}"/>`;
  if (look.hair === 'bun') back = `<circle cx="${cx}" cy="${top - 4}" r="11" fill="${hair}"/>`;

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

  // Hair on top of the head.
  let front: string;
  switch (look.hair) {
    case 'short':
    case 'long':
    case 'ponytail':
    case 'bun':
      front = `<path d="M${cx - face.rx - 2} ${cy - 4} Q${cx - face.rx - 2} ${top - 6} ${cx} ${top - 6} Q${cx + face.rx + 2} ${top - 6} ${cx + face.rx + 2} ${cy - 4} Q${cx + face.rx - 4} ${top + 8} ${cx + 4} ${top + 9} Q${cx - 10} ${top + 12} ${cx - face.rx + 3} ${cy - 2} Z" fill="${hair}"/>`;
      break;
    case 'buzz':
      front = `<path d="M${cx - face.rx + 1} ${cy - 8} Q${cx - face.rx} ${top - 1} ${cx} ${top - 1} Q${cx + face.rx} ${top - 1} ${cx + face.rx - 1} ${cy - 8} Q${cx} ${top + 6} ${cx - face.rx + 1} ${cy - 8} Z" fill="${hair}" opacity="0.85"/>`;
      break;
    case 'curls':
      front = Array.from({ length: 9 }, (_, i) => {
        const a = Math.PI + (i / 8) * Math.PI;
        return `<circle cx="${(cx + Math.cos(a) * (face.rx + 1)).toFixed(1)}" cy="${(cy - 6 + Math.sin(a) * (face.ry - 2)).toFixed(1)}" r="8" fill="${hair}"/>`;
      }).join('');
      break;
    case 'undercut':
      front = `<path d="M${cx - face.rx + 2} ${cy - 10} Q${cx - 6} ${top - 10} ${cx + face.rx + 4} ${top + 2} Q${cx + face.rx + 2} ${top + 10} ${cx + face.rx - 2} ${cy - 10} Q${cx} ${top + 4} ${cx - face.rx + 2} ${cy - 10} Z" fill="${hair}"/>`;
      break;
    default:
      front = '';
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" class="portrait" role="img" aria-label="Captain portrait"><rect width="120" height="140" rx="16" fill="#141b2c"/><circle cx="60" cy="58" r="52" fill="#1c2640"/>${back}${outfit}${neck}${ears}${head}${eyeRow}${brows}${nose}${mouth}${front}</svg>`;
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
