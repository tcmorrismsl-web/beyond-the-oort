/**
 * Seeded random numbers (mulberry32). Every gameplay roll goes through an Rng
 * so a galaxy, a loot drop or a bug report can be reproduced from its seed.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with an empty list');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Current state, so a save can resume the same sequence. */
  get seed(): number {
    return this.state;
  }
}

/** Seed for a brand-new game; the only place non-deterministic randomness is allowed. */
export function freshSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}
