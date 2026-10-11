/**
 * Pendulum wave for the composer working-status slot: a row of pendulums seen
 * from above, squeezed into the same word-sized single row as the wave. Each
 * column is one bob; its block height is the swing position. Bob n swings
 * BASE + n times a cycle, so the row drifts from one flat line into a wave, a
 * braid and a zigzag, then lines up again once a cycle. Pure and
 * deterministic: the tick alone picks the frame.
 */

const BLOCKS = "▁▂▃▄▅▆▇█";
const COLUMNS = 7; // the wave's width: same slot, same size
const BASE = 10; // swings the slowest bob makes in one cycle
const CYCLE = 40; // ticks until every bob lines up again

/** Ticks after which the animation repeats exactly. */
export const PENDULUM_PERIOD = CYCLE;

/**
 * One fixed-width pendulum frame (7 visible columns, word-sized).
 * Never throws; degenerate ticks render frame zero.
 */
export function pendulumFrame(tick: number): string {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const step = safe % CYCLE;
  let frame = "";
  for (let n = 0; n < COLUMNS; n++) {
    const height = (1 - Math.cos((2 * Math.PI * (BASE + n) * step) / CYCLE)) / 2;
    frame += BLOCKS[Math.round(height * (BLOCKS.length - 1))];
  }
  return frame;
}
