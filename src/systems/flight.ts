/**
 * Ship flight as pure functions: no Phaser, no DOM. That keeps it unit
 * testable and lets the same rules drive the player, AI ships and replays.
 * Units: pixels, seconds, radians.
 */
export interface FlightStats {
  thrust: number;   // acceleration, px/s^2
  maxSpeed: number; // px/s
  turnRate: number; // rad/s
  drag: number;     // exponential decay per second; 0 = Newtonian
}

export interface ShipKinematics {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

export interface FlightInput {
  throttle: number;            // 0..1
  targetAngle: number | null;  // null = hold heading
}

const TAU = Math.PI * 2;

/** Shortest signed difference from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function wrapAngle(a: number): number {
  const w = a % TAU;
  return w < 0 ? w + TAU : w;
}

export function stepShip(s: ShipKinematics, stats: FlightStats, input: FlightInput, dt: number): ShipKinematics {
  const throttle = Math.min(1, Math.max(0, Number.isFinite(input.throttle) ? input.throttle : 0));

  let angle = s.angle;
  if (input.targetAngle !== null && Number.isFinite(input.targetAngle)) {
    const delta = angleDelta(angle, input.targetAngle);
    const maxTurn = stats.turnRate * dt;
    angle += Math.abs(delta) <= maxTurn ? delta : Math.sign(delta) * maxTurn;
  }
  angle = wrapAngle(angle);

  let vx = s.vx + Math.cos(angle) * stats.thrust * throttle * dt;
  let vy = s.vy + Math.sin(angle) * stats.thrust * throttle * dt;

  // Frame-rate independent drag (same result at 60Hz and 120Hz).
  const decay = Math.exp(-stats.drag * dt);
  vx *= decay;
  vy *= decay;

  const speed = Math.hypot(vx, vy);
  if (speed > stats.maxSpeed) {
    const k = stats.maxSpeed / speed;
    vx *= k;
    vy *= k;
  }

  return { x: s.x + vx * dt, y: s.y + vy * dt, vx, vy, angle };
}

/**
 * Fixed-timestep accumulator. Simulation always advances in exact STEP
 * increments regardless of display rate (60Hz, 120Hz ProMotion, or 30Hz in
 * Low Power Mode), and a long stall (app switched away) is capped so the
 * game never fast-forwards through a pile of frames.
 */
export const STEP = 1 / 60;
const MAX_FRAME = 0.25;

export function consumeSteps(accumulator: number, frameSeconds: number): { steps: number; remainder: number } {
  const frame = Math.min(Math.max(frameSeconds, 0), MAX_FRAME);
  let acc = accumulator + frame;
  let steps = 0;
  // Tolerance absorbs float drift so two 1/120s frames reliably make one step.
  while (acc >= STEP - 1e-9) {
    acc -= STEP;
    steps += 1;
  }
  return { steps, remainder: Math.max(acc, 0) };
}
