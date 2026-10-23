import type Phaser from 'phaser';
import type { Body, StarSystem } from '../data/schema';

/**
 * Placeholder art for stars, planets and stations, generated from content
 * data (color, radius). Real art can replace these texture keys later
 * without touching gameplay.
 */
export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

export function starKey(sys: StarSystem): string {
  return `star-${sys.id}`;
}

export function bodyKey(body: Body): string {
  return `body-${body.id}`;
}

export function ensureStarTexture(scene: Phaser.Scene, sys: StarSystem): string {
  const key = starKey(sys);
  if (scene.textures.exists(key)) return key;
  const c = hexToNumber(sys.star.color);
  const r = sys.star.radius;
  const size = r * 4;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let i = 6; i >= 1; i -= 1) {
    g.fillStyle(c, 0.06 * (7 - i));
    g.fillCircle(size / 2, size / 2, r + i * (r * 0.15));
  }
  g.fillStyle(c, 1);
  g.fillCircle(size / 2, size / 2, r);
  g.fillStyle(shade(c, 1.25) | 0x202020, 1);
  g.fillCircle(size / 2, size / 2, r * 0.6);
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}

export function ensureBodyTexture(scene: Phaser.Scene, body: Body): string {
  const key = bodyKey(body);
  if (scene.textures.exists(key)) return key;
  const c = hexToNumber(body.color);
  const r = body.radius;
  const pad = 6;
  const size = (r + pad) * 2;
  const mid = size / 2;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  if (body.kind === 'planet') {
    g.fillStyle(shade(c, 0.45), 1);
    g.fillCircle(mid, mid, r);
    g.fillStyle(c, 1);
    g.fillCircle(mid - r * 0.12, mid - r * 0.12, r * 0.88);
    g.fillStyle(shade(c, 1.3), 0.5);
    g.fillCircle(mid - r * 0.35, mid - r * 0.35, r * 0.35);
    g.lineStyle(2, shade(c, 1.4), 0.35);
    g.strokeCircle(mid, mid, r);
  } else {
    // Station: a ring with spokes and a hub.
    g.lineStyle(Math.max(3, r * 0.18), c, 1);
    g.strokeCircle(mid, mid, r * 0.8);
    g.lineStyle(Math.max(2, r * 0.1), shade(c, 0.8), 1);
    g.lineBetween(mid - r, mid, mid + r, mid);
    g.lineBetween(mid, mid - r, mid, mid + r);
    g.fillStyle(shade(c, 1.15), 1);
    g.fillCircle(mid, mid, r * 0.3);
    g.fillStyle(0x8fd8ff, 0.9);
    g.fillCircle(mid + r * 0.8, mid, Math.max(2, r * 0.08));
  }
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}
