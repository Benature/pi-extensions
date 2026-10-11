import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  advanceTrain,
  isTrainActive,
  setTrainActive,
  trainFrame,
  trainTick,
  TRAIN_PERIOD,
} from "../extensions/pi-slate/working-train.ts";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

test("the same tick always renders the identical frame", () => {
  for (const tick of [0, 1, 7, 100, 3333]) {
    assert.equal(trainFrame(tick), trainFrame(tick));
  }
});

test("frames are word-sized and fixed width", () => {
  for (let tick = 0; tick < 1000; tick++) {
    const frame = trainFrame(tick);
    assert.equal(visibleWidth(frame), 7, `tick ${tick}: "${frame}"`);
    assert.ok(visibleWidth(frame) <= 10, `tick ${tick}: no wider than a working word`);
  }
});

test("frames contain no ANSI escapes or control characters", () => {
  for (let tick = 0; tick < 1000; tick++) {
    assert.ok(!CONTROL_CHARS.test(trainFrame(tick)), `tick ${tick}`);
  }
});

test("the animation loops exactly after TRAIN_PERIOD ticks", () => {
  assert.ok(TRAIN_PERIOD >= 4 && TRAIN_PERIOD <= 8, "small in-place loop");
  for (const tick of [0, 1, 5, TRAIN_PERIOD, TRAIN_PERIOD + 3, 9997]) {
    assert.equal(trainFrame(tick), trainFrame(tick + TRAIN_PERIOD), `tick ${tick}`);
  }
  const frames = new Set<string>();
  for (let tick = 0; tick < TRAIN_PERIOD; tick++) frames.add(trainFrame(tick));
  assert.ok(frames.size >= 3, "the loop animates through distinct frames");
  for (let tick = 0; tick < 100; tick++) {
    assert.notEqual(trainFrame(tick), trainFrame(tick + 1), `tick ${tick}: every tick moves the animation`);
  }
});

test("the train never travels: every frame is the same locomotive in place", () => {
  for (let tick = 0; tick < 1000; tick++) {
    assert.match(trainFrame(tick), /^[o@]-[o@]==[.oO]>$/, `tick ${tick}`);
  }
});

test("wheels alternate every tick", () => {
  for (let tick = 0; tick < 100; tick++) {
    const wheels = tick % 2 === 0 ? "o" : "@";
    assert.equal(trainFrame(tick).startsWith(`${wheels}-${wheels}==`), true, `tick ${tick}`);
  }
});

test("the smoke puff cycles through distinct shapes", () => {
  const puffs = new Set<string>();
  for (let tick = 0; tick < TRAIN_PERIOD; tick++) puffs.add(trainFrame(tick).at(-2)!);
  assert.ok(puffs.size >= 3, `expected at least 3 distinct puffs, saw ${[...puffs].join(" ")}`);
});

test("degenerate ticks render frame zero", () => {
  const zero = trainFrame(0);
  for (const tick of [Number.NaN, Number.NEGATIVE_INFINITY, -12, 1.9]) {
    const expected = Number.isFinite(tick) && tick >= 0 ? trainFrame(Math.floor(tick)) : zero;
    assert.equal(trainFrame(tick), expected, `tick ${tick}`);
  }
});

test("shared state toggles, resets, and advances", () => {
  try {
    setTrainActive(false);
    assert.equal(isTrainActive(), false);
    setTrainActive(true);
    assert.equal(isTrainActive(), true);
    assert.equal(trainTick(), 0, "activation restarts the loop");
    assert.equal(advanceTrain(), 1);
    assert.equal(advanceTrain(), 2);
    assert.equal(trainTick(), 2);
    setTrainActive(true);
    assert.equal(trainTick(), 2, "re-activation keeps the running loop");
    setTrainActive(false);
    assert.equal(isTrainActive(), false);
    setTrainActive(true);
    assert.equal(trainTick(), 0, "restarting resets the loop");
  } finally {
    setTrainActive(false);
  }
});
