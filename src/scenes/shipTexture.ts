import Phaser from 'phaser';
import type { Paint } from '../core/state';
import { paintKey, shipSvg, svgDataUri } from '../ui/art';

/** Display size of your ship in flight (world units); the texture is drawn at 2x for crisp edges. */
export const SHIP_DISPLAY = { width: 36, height: 28 };

/**
 * Get the texture for a paint job. If it isn't built yet, start building it
 * from the same SVG the menus show, return the plain placeholder for now,
 * and call `onReady` when the painted texture is available.
 */
export function shipTextureFor(scene: Phaser.Scene, paint: Paint, onReady: (key: string) => void): string {
  const key = paintKey(paint);
  if (scene.textures.exists(key)) return key;
  scene.textures.once(`${Phaser.Textures.Events.ADD_KEY}${key}`, () => {
    onReady(key);
  });
  scene.textures.addBase64(key, svgDataUri(shipSvg(paint)));
  return 'ship';
}
