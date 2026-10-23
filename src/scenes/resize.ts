import Phaser from 'phaser';

/**
 * Call `fit` whenever the game is resized (rotation), and remove the
 * listener when the scene shuts down. Every scene that draws anything
 * size-dependent must use this: iOS rotation does not reliably resize
 * cameras on its own (see main.ts for the size watchdog).
 */
export function onScreenResize(scene: Phaser.Scene, fit: () => void): void {
  const handler = (): void => {
    fit();
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, handler);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, handler);
  });
}

/**
 * Listen to a scene event and stop listening on shutdown. Scene event
 * emitters survive scene restarts, so plain `events.on` would stack handlers.
 */
export function onSceneEvent(scene: Phaser.Scene, event: string, fn: (...args: unknown[]) => void): void {
  scene.events.on(event, fn);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(event, fn);
  });
}

/** Two tile-sprite star layers that fill the screen (used by non-flight scenes). */
export function addStarBackdrop(scene: Phaser.Scene): { far: Phaser.GameObjects.TileSprite; near: Phaser.GameObjects.TileSprite } {
  const { width, height } = scene.scale;
  const far = scene.add.tileSprite(0, 0, width, height, 'stars-far').setOrigin(0).setScrollFactor(0).setDepth(-20);
  const near = scene.add.tileSprite(0, 0, width, height, 'stars-near').setOrigin(0).setScrollFactor(0).setDepth(-19);
  return { far, near };
}
