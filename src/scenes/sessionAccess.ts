import type Phaser from 'phaser';
import { Session } from '../core/session';

/** Registry key for the one live Session shared by every scene. */
export const SESSION_KEY = 'session';

export function getSession(scene: Phaser.Scene): Session {
  const s: unknown = scene.registry.get(SESSION_KEY);
  if (!(s instanceof Session)) throw new Error('session missing from game registry');
  return s;
}
