/**
 * Animated ASCII steam train shown as the working widget while the model runs.
 * Pure and deterministic: the same (width, tick) always yields the same lines,
 * plain text only — the host wraps each line in a Text component.
 */

const TRAIN_WIDTH = 34;
const MINI_WIDTH = 5;

// Smoke puffs above the chimney, cycled by animation step.
const SMOKE = ["  (o)  ", " ( o ) ", " (o o) "] as const;

// Static body, painted onto a blank canvas in order (later stamps overdraw).
// Front (chimney, cowcatcher) faces right; the train travels left-to-right.
const BODY_STAMPS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 3, "____"],
  [1, 25, "__|  |__"],
  [2, 2, "|    |"],
  [2, 27, "|  |"],
  [3, 2, "| [] |"],
  [3, 8, "__________________________"],
  [3, 27, "|  |"],
  [4, 2, "|______________________________"],
  [4, 33, ">"],
];

const WHEELS = [3, 12, 21, 29] as const;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

function buildTrain(step: number): string[] {
  const grid: string[][] = Array.from({ length: 6 }, () => Array<string>(TRAIN_WIDTH).fill(" "));
  const stamp = (line: number, col: number, text: string): void => {
    const row = grid[line]!;
    for (let i = 0; i < text.length && col + i < TRAIN_WIDTH; i++) row[col + i] = text[i]!;
  };
  for (const [line, col, text] of BODY_STAMPS) stamp(line, col, text);
  // Alternating rims read as turning wheels; neighbouring wheels run out of phase.
  WHEELS.forEach((col, index) => stamp(5, col, (step + index) % 2 === 0 ? "(o)" : "(@)"));
  stamp(0, 25, SMOKE[step % SMOKE.length]!);
  return grid.map((row) => row.join("").replace(/\s+$/, ""));
}

/** Full-width rail; ties drift against the travel direction to sell the motion. */
function trackLine(width: number, step: number): string {
  let line = "";
  for (let c = 0; c < width; c++) line += (c + step) % 6 === 2 ? "┴" : "═";
  return line;
}

/** Copy the visible slice of an art line whose left edge sits at window column x. */
function windowLine(art: string, x: number, width: number): string {
  const start = Math.max(0, -x);
  const dest = Math.max(0, x);
  const length = Math.min(art.length - start, width - dest);
  return length <= 0 ? "" : " ".repeat(dest) + art.slice(start, start + length);
}

function fullFrame(width: number, step: number): string[] {
  const span = width + TRAIN_WIDTH;
  const x = (step % span) - TRAIN_WIDTH; // fully off the left edge through to the right edge
  const lines = buildTrain(step).map((art) => windowLine(art, x, width));
  lines.push(trackLine(width, step));
  return lines;
}

function miniFrame(width: number, step: number): string[] {
  const art = step % 2 === 0 ? "o-o=>" : "@-@=>";
  const span = width + MINI_WIDTH;
  return [windowLine(art, (step % span) - MINI_WIDTH, width), trackLine(width, step)];
}

function tinyFrame(width: number, step: number): string[] {
  return [(step % 2 === 0 ? "o-o>" : "@-@>").slice(0, width)];
}

/** Ticks after which a frame repeats exactly; the train moves one column per two ticks. */
export function trainPeriod(width: number): number {
  const w = Math.floor(width);
  if (!Number.isFinite(w) || w < 1) return 1;
  if (w < 10) return 4;
  if (w < 24) return 2 * lcm(w + MINI_WIDTH, 6);
  return 2 * lcm(w + TRAIN_WIDTH, 6);
}

/**
 * ASCII art lines for one animation frame. Never throws and never emits a line
 * wider than `width`; widths under 24 degrade to a small chugger, under 10 to
 * a single short line, and under 1 to no lines at all.
 */
export function trainFrame(width: number, tick: number): string[] {
  const w = Math.floor(width);
  if (!Number.isFinite(w) || w < 1) return [];
  const safeTick = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const step = Math.floor(safeTick / 2);
  if (w < 10) return tinyFrame(w, step);
  if (w < 24) return miniFrame(w, step);
  return fullFrame(w, step);
}
