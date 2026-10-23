/**
 * Floating virtual joystick math. The stick appears wherever the thumb lands,
 * which works for any hand size and avoids a fixed control hidden under the
 * home indicator or notch.
 */
export interface StickReading {
  active: boolean;
  throttle: number;           // 0..1
  angle: number | null;       // radians, null inside the dead zone
}

export const IDLE: StickReading = { active: false, throttle: 0, angle: null };

export function readStick(
  originX: number,
  originY: number,
  pointerX: number,
  pointerY: number,
  radius: number,
  deadZone = 0.12,
): StickReading {
  const dx = pointerX - originX;
  const dy = pointerY - originY;
  const dist = Math.hypot(dx, dy);
  const norm = radius > 0 ? Math.min(1, dist / radius) : 0;
  if (norm < deadZone) return { active: true, throttle: 0, angle: null };
  // Rescale so throttle starts at 0 just outside the dead zone.
  const throttle = (norm - deadZone) / (1 - deadZone);
  return { active: true, throttle, angle: Math.atan2(dy, dx) };
}
