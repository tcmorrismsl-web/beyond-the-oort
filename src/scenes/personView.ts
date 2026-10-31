import Phaser from 'phaser';
import type { Look } from '../core/state';
import { STRIDE, TILE_PX, walkPose, type Pose } from '../systems/onfoot';
import { hexToNumber } from './systemTextures';

/**
 * How far (px) a foot reaches ahead/behind at full stride, and a hand swings.
 * FOOT_REACH = stride length / 2π, so a planted foot moves backward exactly as
 * fast as the body moves forward: no sliding (see STRIDE in systems/onfoot.ts).
 */
const FOOT_REACH = (STRIDE * TILE_PX) / (Math.PI * 2);
const HAND_SWING = 7;
/** Feet sit this far either side of the body's centerline, hands a little wider. */
const FOOT_SPREAD = 5;
const HAND_SPREAD = 10.5;
/** Bob: how much the body "rises" at each step, as a scale change (top-down). */
const BOB_SCALE = 0.045;
const BOOT = 0x4a5162;
const BOOT_TOE = 0x6a7284;

/**
 * A person seen from above, built from parts so they can walk: boots step,
 * hands swing opposite the feet, and the head and shoulders bob slightly with
 * each step. Facing right (+x) at rotation 0, like everything else.
 */
export class PersonView {
  readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly leftFoot: Phaser.GameObjects.Container;
  private readonly rightFoot: Phaser.GameObjects.Container;
  private readonly leftHand: Phaser.GameObjects.Arc;
  private readonly rightHand: Phaser.GameObjects.Arc;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, look: Look, x: number, y: number, depth: number) {
    const skin = hexToNumber(look.skin);
    this.shadow = scene.add.ellipse(2, 3, 28, 30, 0x000000, 0.32);
    const boot = (y: number): Phaser.GameObjects.Container =>
      scene.add.container(0, y, [scene.add.ellipse(0, 0, 13, 7, BOOT), scene.add.ellipse(3.5, 0, 5, 5, BOOT_TOE)]);
    this.leftFoot = boot(-FOOT_SPREAD);
    this.rightFoot = boot(FOOT_SPREAD);
    this.body = scene.add.image(0, 0, ensureBodyTexture(scene, look));
    this.leftHand = scene.add.circle(2, -HAND_SPREAD, 3.2, skin);
    this.rightHand = scene.add.circle(2, HAND_SPREAD, 3.2, skin);
    this.root = scene.add.container(x, y, [this.shadow, this.leftFoot, this.rightFoot, this.leftHand, this.rightHand, this.body]).setDepth(depth);
    this.setPose(walkPose(0, 0));
  }

  setPosition(x: number, y: number, facing: number): this {
    this.root.setPosition(x, y).setRotation(facing);
    return this;
  }

  setPose(p: Pose): this {
    this.leftFoot.x = p.leftFoot * FOOT_REACH;
    this.rightFoot.x = p.rightFoot * FOOT_REACH;
    this.leftHand.x = 2 + p.leftHand * HAND_SWING;
    this.rightHand.x = 2 + p.rightHand * HAND_SWING;
    this.body.setScale(1 + p.bob * BOB_SCALE);
    // A slight shoulder twist toward the leading foot reads as weight shifting.
    this.body.setRotation(p.leftFoot * 0.08);
    return this;
  }

  setAlpha(a: number): this {
    this.root.setAlpha(a);
    return this;
  }

  get x(): number {
    return this.root.x;
  }

  get y(): number {
    return this.root.y;
  }

  destroy(): void {
    this.root.destroy();
  }
}

/** Shoulders, head and hair from above (hands and boots are separate, so they can move). */
function ensureBodyTexture(scene: Phaser.Scene, look: Look): string {
  const key = `person-body-${look.skin}-${look.hair}-${look.hairColor}-${look.outfitColor}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const S = 36;
  const c = S / 2;
  g.fillStyle(hexToNumber(look.outfitColor), 1);
  g.fillEllipse(c - 2, c, 16, 26); // shoulders
  g.fillStyle(0x000000, 0.18);
  g.fillEllipse(c - 5, c, 8, 22); // back shading
  g.fillStyle(hexToNumber(look.skin), 1);
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
