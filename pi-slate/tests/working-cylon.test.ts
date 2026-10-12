import assert from "node:assert/strict";
import test from "node:test";
import { CYLON_PERIOD, cylonFrame } from "../extensions/pi-slate/working-cylon.ts";
import { progressFrame, setProgressStyle } from "../extensions/pi-slate/working-wave.ts";

const CYLON_ONLY = /^\[[ =]{10}\]$/;

test("cylon frame is deterministic for a given tick", () => {
  for (const tick of [0, 1, 5, 6, 42, 1000]) {
    assert.equal(cylonFrame(tick), cylonFrame(tick));
  }
});

test("cylon frame is always a bracketed twelve columns with no control characters", () => {
  for (let tick = 0; tick < 1000; tick++) {
    const frame = cylonFrame(tick);
    assert.match(frame, CYLON_ONLY, `tick ${tick}`);
    assert.equal([...frame].length, 12);
    assert.ok(!/[\x00-\x1f\x7f]/.test(frame), `tick ${tick}: no control chars`);
  }
});

test("cylon shrinks to a narrower budget and never exceeds its natural width", () => {
  assert.equal([...cylonFrame(3, 8)].length, 8);
  assert.equal([...cylonFrame(3, 100)].length, 12);
  assert.equal([...cylonFrame(3, 2)].length, 4);
  assert.match(cylonFrame(3, 8), /^\[[ =]{6}\]$/);
});

test("the eye sweeps out and back", () => {
  const frames = Array.from({ length: CYLON_PERIOD }, (_, tick) => cylonFrame(tick));
  assert.deepEqual(frames, [
    "[==        ]", "[ ==       ]", "[  ==      ]", "[   ==     ]", "[    ==    ]",
    "[     ==   ]", "[      ==  ]", "[       == ]", "[        ==]", "[       == ]",
    "[      ==  ]", "[     ==   ]", "[    ==    ]", "[   ==     ]", "[  ==      ]",
    "[ ==       ]",
  ]);
});

test("cylon loops exactly after CYLON_PERIOD ticks", () => {
  for (let tick = 0; tick < CYLON_PERIOD; tick++) {
    assert.equal(cylonFrame(tick), cylonFrame(tick + CYLON_PERIOD));
    assert.equal(cylonFrame(tick), cylonFrame(tick + CYLON_PERIOD * 25));
  }
});

test("every tick animates: consecutive frames differ", () => {
  for (let tick = 0; tick < CYLON_PERIOD; tick++) {
    assert.notEqual(cylonFrame(tick), cylonFrame(tick + 1), `ticks ${tick}/${tick + 1}`);
  }
});

test("degenerate ticks render frame zero", () => {
  assert.equal(cylonFrame(Number.NaN), cylonFrame(0));
  assert.equal(cylonFrame(-3), cylonFrame(0));
  assert.equal(cylonFrame(2.9), cylonFrame(2));
});

test("progress frame dispatches cylon-scanner when selected", () => {
  setProgressStyle("cylon-scanner");
  assert.equal(progressFrame(3), cylonFrame(3));
  setProgressStyle("waves");
});
