/**
 * Tiny sine wave that sits in the composer top border's working-status slot
 * while the model runs — the same slot the italic working word used to fill.
 * Pure and deterministic: the tick alone picks the frame. The wave animates
 * in place (block heights travel across seven columns); it never moves.
 */

const BLOCKS = "▁▂▃▄▅▆▇█";
const COLUMNS = 7;

/** Ticks after which the animation repeats exactly. */
export const WAVE_PERIOD = 8;

/**
 * One fixed-width wave frame (7 visible columns, word-sized).
 * Never throws; degenerate ticks render frame zero.
 */
export function waveFrame(tick: number): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const step = safe % WAVE_PERIOD;
  let frame = "";
  for (let x = 0; x < COLUMNS; x++) {
    frame += BLOCKS[Math.round(3.5 + 3.5 * Math.sin(((x - step) * Math.PI) / 4))];
  }
  return frame;
}

// Shared animation state: index.ts advances it on a timer, the composer reads
// it while rendering the top border. Module-level so the render path stays
// trivial and the generator above stays pure.
let active = false;
let tick = 0;

export function setWaveActive(on: boolean): void {
  if (on && !active) tick = 0;
  active = on;
}

export function isWaveActive(): boolean {
  return active;
}

export function waveTick(): number {
  return tick;
}

export function advanceWave(): number {
  tick += 1;
  return tick;
}
