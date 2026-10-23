import Phaser from 'phaser';

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

    g.fillStyle(0xffffff, 1);
    g.fillCircle(2, 2, 2);
    g.generateTexture('star', 4, 4);
    g.clear();

    g.lineStyle(3, 0xffffff, 0.35);
    g.strokeCircle(60, 60, 57);
    g.generateTexture('stick-ring', 120, 120);
    g.clear();

    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(26, 26, 26);
    g.generateTexture('stick-knob', 52, 52);
    g.destroy();

    this.scene.start('flight');
  }
}
