/**
 * Tiny steam train that sits in the composer top border's working-status slot
 * while the model runs — the same slot the italic working word used to fill.
 * Pure and deterministic: the tick alone picks the frame. The train animates
 * in place (wheels alternate, a small smoke puff cycles); it never travels.
 */

// Two out-of-phase rims read as turning wheels; the puff grows and shrinks.
const PUFFS = [".", "o", "O", "o"] as const;

/** Ticks after which the animation repeats exactly. */
export const TRAIN_PERIOD = 4;

/**
 * One fixed-width locomotive frame (7 visible columns, word-sized).
 * Never throws; degenerate ticks render frame zero.
 */
export function trainFrame(tick: number): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const step = safe % TRAIN_PERIOD;
  const wheels = step % 2 === 0 ? "o" : "@";
  return `${wheels}-${wheels}==${PUFFS[step]}>`;
}

// Shared animation state: index.ts advances it on a timer, the composer reads
// it while rendering the top border. Module-level so the render path stays
// trivial and the generator above stays pure.
let active = false;
let tick = 0;

export function setTrainActive(on: boolean): void {
  if (on && !active) tick = 0;
  active = on;
}

export function isTrainActive(): boolean {
  return active;
}

export function trainTick(): number {
  return tick;
}

export function advanceTrain(): number {
  tick += 1;
  return tick;
}
