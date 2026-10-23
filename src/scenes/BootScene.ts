import Phaser from 'phaser';
import { Rng } from '../core/rng';

/** Fixed seeds: the background looks the same on every launch and device. */
const FAR_STARS_SEED = 0x51a7;
const NEAR_STARS_SEED = 0x0e7e;
const STAR_TILE = 512;

/**
 * Generates placeholder textures in code so the prototype has zero art
 * dependencies. Real art replaces these keys later without touching gameplay.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    g.fillStyle(0xdfe8ff, 1);
    g.fillTriangle(30, 12, 0, 0, 0, 24);
    g.fillStyle(0x4fc3ff, 1);
    g.fillRect(0, 9, 6, 6);
    g.generateTexture('ship', 30, 24);
    g.clear();

    // Two repeating star layers. Tiling keeps space evenly full of stars
    // everywhere you fly, at the cost of one small texture each.
    this.starTile(g, 'stars-far', FAR_STARS_SEED, 110, 0.5, 1.1, 0.25, 0.6);
    this.starTile(g, 'stars-near', NEAR_STARS_SEED, 40, 0.9, 1.8, 0.5, 0.95);

    // Engine flame, drawn pointing right with its base at the left edge;
    // the scene stretches it with throttle and tints it during cruise.
    g.fillStyle(0xffffff, 0.35);
    g.fillTriangle(0, 0, 32, 8, 0, 16);
    g.fillStyle(0xffffff, 0.9);
    g.fillTriangle(0, 4, 18, 8, 0, 12);
    g.generateTexture('flame', 32, 16);
    g.clear();

    g.fillStyle(0xffd27a, 0.85);
    g.fillTriangle(18, 9, 0, 0, 0, 18);
    g.generateTexture('home-arrow', 18, 18);
    g.clear();

    // Smaller arrow pointing at off-screen ports; tinted with the body's color.
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(12, 6, 0, 0, 0, 12);
    g.generateTexture('port-arrow', 12, 12);
    g.clear();

    g.lineStyle(3, 0xffffff, 0.35);
    g.strokeCircle(60, 60, 57);
    g.generateTexture('stick-ring', 120, 120);
    g.clear();

    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(26, 26, 26);
    g.generateTexture('stick-knob', 52, 52);
    g.destroy();

    this.scene.start('title');
  }

  private starTile(
    g: Phaser.GameObjects.Graphics,
    key: string,
    seed: number,
    count: number,
    minR: number,
    maxR: number,
    minA: number,
    maxA: number,
  ): void {
    const rng = new Rng(seed);
    for (let i = 0; i < count; i += 1) {
      g.fillStyle(0xffffff, rng.range(minA, maxA));
      // Keep stars off the tile edges so no half-stars show at the seams.
      g.fillCircle(rng.range(maxR, STAR_TILE - maxR), rng.range(maxR, STAR_TILE - maxR), rng.range(minR, maxR));
    }
    g.generateTexture(key, STAR_TILE, STAR_TILE);
    g.clear();
  }
}
