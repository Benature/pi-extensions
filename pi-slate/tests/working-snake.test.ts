import assert from "node:assert/strict";
import test from "node:test";
import { SNAKE_PERIOD, snakeFrame } from "../extensions/pi-slate/working-snake.ts";
import { progressFrame, setProgressStyle } from "../extensions/pi-slate/working-wave.ts";

const SNAKE_ONLY = /^[><\\/~ ]{7}$/;

test("snake frame is deterministic for a given tick", () => {
  for (const tick of [0, 1, 7, 13, 14, 42, 1000]) {
    assert.equal(snakeFrame(tick), snakeFrame(tick));
  }
});

test("snake frame is always seven columns with no control characters", () => {
  for (let tick = 0; tick < 1000; tick++) {
    const frame = snakeFrame(tick);
    assert.match(frame, SNAKE_ONLY, `tick ${tick}`);
    assert.equal([...frame].length, 7);
    assert.ok(!/[\x00-\x1f\x7f]/.test(frame), `tick ${tick}: no control chars`);
  }
});

test("snake loops exactly after SNAKE_PERIOD ticks", () => {
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) {
    assert.equal(snakeFrame(tick), snakeFrame(tick + SNAKE_PERIOD));
    assert.equal(snakeFrame(tick), snakeFrame(tick + SNAKE_PERIOD * 25));
  }
});

test("every tick animates: consecutive frames differ", () => {
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) {
    assert.notEqual(snakeFrame(tick), snakeFrame(tick + 1), `ticks ${tick}/${tick + 1}`);
  }
});

test("the snake has a head, a sloping body, a flicking tongue, and wraps the slot", () => {
  const seen = new Set<string>();
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) for (const ch of snakeFrame(tick)) seen.add(ch);
  for (const ch of [">", "/", "\\", "~", "<"]) assert.ok(seen.has(ch), `expected ${ch} somewhere in a lap`);
  for (let tick = 0; tick < SNAKE_PERIOD; tick++) {
    assert.ok(snakeFrame(tick).includes(">"), `tick ${tick}: the head is always on screen`);
  }
});

test("degenerate ticks render frame zero", () => {
  assert.equal(snakeFrame(Number.NaN), snakeFrame(0));
  assert.equal(snakeFrame(-3), snakeFrame(0));
  assert.equal(snakeFrame(2.9), snakeFrame(2));
});

test("progress frame dispatches snake when selected", () => {
  setProgressStyle("snake");
  assert.equal(progressFrame(3), snakeFrame(3));
  setProgressStyle("waves");
});
