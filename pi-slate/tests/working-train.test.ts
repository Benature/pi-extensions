import assert from "node:assert/strict";
import test from "node:test";
import { trainFrame, trainPeriod } from "../extensions/pi-slate/working-train.ts";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const visibleWidth = (line: string): number => [...line].length;

test("same width and tick always render identical lines", () => {
  for (const width of [10, 24, 40, 80, 120]) {
    for (const tick of [0, 1, 7, 100, 3333]) {
      assert.deepEqual(trainFrame(width, tick), trainFrame(width, tick));
    }
  }
  // Motion advances one column per two ticks, so consecutive odd/even pairs match.
  assert.deepEqual(trainFrame(80, 41), trainFrame(80, 40));
  assert.notDeepEqual(trainFrame(80, 42), trainFrame(80, 40));
});

test("frames loop exactly after trainPeriod ticks", () => {
  for (const width of [10, 24, 40, 80, 120]) {
    const period = trainPeriod(width);
    for (const tick of [0, 1, 5, period, period + 3]) {
      assert.deepEqual(trainFrame(width, tick), trainFrame(width, tick + period), `width ${width} tick ${tick}`);
    }
  }
});

test("no line is ever wider than the given width", () => {
  for (const width of [1, 5, 9, 10, 23, 24, 40, 80, 120]) {
    for (let tick = 0; tick < 500; tick++) {
      for (const line of trainFrame(width, tick)) {
        assert.ok(visibleWidth(line) <= width, `width ${width} tick ${tick}: "${line}"`);
      }
    }
  }
});

test("frames contain no ANSI escapes or control characters", () => {
  for (const width of [3, 10, 24, 80]) {
    for (let tick = 0; tick < 200; tick++) {
      for (const line of trainFrame(width, tick)) assert.ok(!CONTROL_CHARS.test(line), `width ${width} tick ${tick}`);
    }
  }
});

test("smoke cycles through distinct puff shapes", () => {
  const puffs = new Set<string>();
  for (let tick = 0; tick < trainPeriod(80); tick++) {
    const puff = trainFrame(80, tick)[0]!.trim();
    if (puff) puffs.add(puff);
  }
  assert.ok(puffs.size >= 3, `expected at least 3 distinct puffs, saw ${puffs.size}`);
});

test("wheels alternate between rims", () => {
  const rims = new Set<string>();
  for (let tick = 0; tick < trainPeriod(80); tick++) {
    const wheels = trainFrame(80, tick).at(-2)!;
    for (const rim of wheels.match(/\((.)\)/g) ?? []) rims.add(rim);
  }
  assert.ok(rims.has("(o)") && rims.has("(@)"), `expected turning wheels, saw ${[...rims].join(" ")}`);
});

test("train fully exits and re-enters the window", () => {
  const width = 40;
  const body = (tick: number): string => trainFrame(width, tick).slice(0, -1).join("");
  assert.equal(body(0).trim(), "", "loop starts with the train fully off the window");
  let seen = false;
  for (let tick = 2; tick < trainPeriod(width); tick++) {
    if (body(tick).includes("(")) { seen = true; break; }
  }
  assert.ok(seen, "train re-enters after exiting");
  assert.equal(body(trainPeriod(width)).trim(), "", "train is fully gone again after one period");
});

test("tiny widths degrade without throwing", () => {
  for (const width of [-5, 0, Number.NaN, 1, 3, 9]) {
    for (const tick of [0, 1, 25]) {
      const lines = trainFrame(width, tick);
      if (width < 1 || Number.isNaN(width)) assert.deepEqual(lines, []);
      else assert.equal(lines.length, 1);
      for (const line of lines) assert.ok(visibleWidth(line) <= Math.max(0, Math.floor(width)) || Number.isNaN(width));
    }
  }
});

test("narrow widths render a minimal two-line chugger", () => {
  for (const width of [10, 16, 23]) {
    const lines = trainFrame(width, 6);
    assert.equal(lines.length, 2);
    assert.ok(lines[1]!.includes("═"), "chugger keeps its rail");
  }
});
