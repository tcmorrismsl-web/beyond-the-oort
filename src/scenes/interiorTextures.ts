import type Phaser from 'phaser';
import type { Interior } from '../data/schema';
import type { Look } from '../core/state';
import { TILE_PX } from '../systems/onfoot';
import { hexToNumber } from './systemTextures';

/**
 * Placeholder art for walkable places and the people in them, generated from
 * content data. Real tile art and character sprites can replace these
 * texture keys later without touching gameplay.
 */
const THEMES: Record<Interior['theme'], { floor: number; floor2: number; wall: number; wallTop: number; prop: number; glow: number }> = {
  derelict: { floor: 0x1a2130, floor2: 0x1e2637, wall: 0x3b4458, wallTop: 0x56627c, prop: 0x4a5368, glow: 0x7fd3ff },
  camp: { floor: 0x2a2320, floor2: 0x2f2824, wall: 0x4d4036, wallTop: 0x6b5a4b, prop: 0x5e5044, glow: 0xffb35a },
  station: { floor: 0x1c2531, floor2: 0x212b39, wall: 0x45546b, wallTop: 0x60728e, prop: 0x506078, glow: 0x9fe0ff },
};

/** The whole floor plan as one texture (drawn once; maps are small). */
export function ensureInteriorTexture(scene: Phaser.Scene, inside: Interior): string {
  const key = `interior-${inside.id}`;
  if (scene.textures.exists(key)) return key;
  const t = THEMES[inside.theme];
  const T = TILE_PX;
  const w = (inside.map[0]?.length ?? 0) * T;
  const h = inside.map.length * T;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  inside.map.forEach((row, y) => {
    // Map rows are plain ASCII (validated), so indexing by character is safe.
    Array.from({ length: row.length }, (_, i) => row.charAt(i)).forEach((ch, x) => {
      const px = x * T;
      const py = y * T;
      if (ch === ' ') return;
      // Floor under everything (props sit on floor).
      g.fillStyle((x + y) % 2 === 0 ? t.floor : t.floor2, 1);
      g.fillRect(px, py, T, T);
      switch (ch) {
        case '#':
          g.fillStyle(t.wall, 1);
          g.fillRect(px, py, T, T);
          g.fillStyle(t.wallTop, 1);
          g.fillRect(px, py, T, 6);
          break;
        case '+':
          g.fillStyle(0x000000, 0.25);
          g.fillRect(px + 4, py + 4, T - 8, T - 8);
          g.lineStyle(2, t.glow, 0.25);
          g.strokeRect(px + 4, py + 4, T - 8, T - 8);
          break;
        case 't':
          g.fillStyle(t.prop, 1);
          g.fillRoundedRect(px + 2, py + 2, T - 4, T - 4, 4);
          g.fillStyle(0xffffff, 0.08);
          g.fillRect(px + 6, py + 6, T - 12, 4);
          break;
        case 'b':
          g.fillStyle(t.prop, 1);
          g.fillRoundedRect(px + 3, py + 2, T - 6, T - 4, 4);
          g.fillStyle(0xcfd6e6, 0.35);
          g.fillRoundedRect(px + 7, py + 5, T - 14, 9, 3);
          break;
        case 'c':
          g.fillStyle(t.prop, 1);
          g.fillRect(px + 3, py + 3, T - 6, T - 6);
          g.lineStyle(2, 0x000000, 0.35);
          g.lineBetween(px + 3, py + 3, px + T - 3, py + T - 3);
          g.lineBetween(px + T - 3, py + 3, px + 3, py + T - 3);
          break;
        case 'k':
          g.fillStyle(t.prop, 1);
          g.fillRoundedRect(px + 3, py + 6, T - 6, T - 12, 4);
          g.fillStyle(t.glow, 0.7);
          g.fillRect(px + 8, py + 12, T - 16, 4);
          break;
        case 'd':
          g.fillStyle(t.prop, 1);
          g.fillCircle(px + T / 2, py + T / 2, T * 0.42);
          g.lineStyle(2, t.glow, 0.5);
          g.strokeCircle(px + T / 2, py + T / 2, T * 0.25);
          break;
        case 'p':
          g.fillStyle(0x3b2f22, 1);
          g.fillRect(px + 2, py + 2, T - 4, T - 4);
          g.fillStyle(0x6b5d3a, 0.55); // long dead
          for (let i = 0; i < 4; i += 1) g.fillCircle(px + 8 + i * 8, py + T / 2, 4);
          break;
        case '~':
          g.fillStyle(0xbfd6ff, 0.18);
          g.fillCircle(px + 10, py + 14, 3);
          g.fillCircle(px + 26, py + 24, 2);
          g.fillCircle(px + 18, py + 32, 2);
          break;
        default:
          break;
      }
    });
  });
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

/** A person seen from above, facing right: shoulders in their outfit color, head, hair. */
export function ensurePersonTexture(scene: Phaser.Scene, look: Look): string {
  const key = `person-${look.skin}-${look.hair}-${look.hairColor}-${look.outfitColor}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const S = 36;
  const c = S / 2;
  g.fillStyle(0x000000, 0.35);
  g.fillEllipse(c + 2, c + 3, 26, 30);
  g.fillStyle(hexToNumber(look.outfitColor), 1);
  g.fillEllipse(c - 2, c, 16, 28); // shoulders
  g.fillStyle(hexToNumber(look.skin), 1);
  g.fillCircle(c + 8, c - 9, 3.2); // hands, reaching forward a little
  g.fillCircle(c + 8, c + 9, 3.2);
  g.fillCircle(c + 1, c, 7.5); // head
  if (look.hair !== 'bald') {
    g.fillStyle(hexToNumber(look.hairColor), 1);
    g.fillCircle(c - 1, c, look.hair === 'buzz' ? 6 : 7.2);
    if (['long', 'ponytail', 'locs'].includes(look.hair)) g.fillEllipse(c - 9, c, 9, 7);
    if (['bun', 'topknot'].includes(look.hair)) g.fillCircle(c - 8, c, 3.5);
    if (look.hair === 'afro' || look.hair === 'curls') g.fillCircle(c - 1, c, 9);
  }
  g.generateTexture(key, S, S);
  g.destroy();
  return key;
}

/**
 * The flashlight: a big square that is clear in the middle and black at the
 * edges. Centered on the player, it leaves a pool of light in a dark place.
 */
export function ensureFlashlightTexture(scene: Phaser.Scene): string {
  const key = 'flashlight';
  if (scene.textures.exists(key)) return key;
  const size = 512;
  const tex = scene.textures.createCanvas(key, size, size);
  const ctx = tex?.getContext();
  if (tex && ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.12, 'rgba(0,0,0,0.04)');
    grad.addColorStop(0.34, 'rgba(0,0,0,0.78)');
    grad.addColorStop(0.52, 'rgba(0,0,0,0.97)');
    grad.addColorStop(1, 'rgba(0,0,0,0.98)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }
  return key;
}
