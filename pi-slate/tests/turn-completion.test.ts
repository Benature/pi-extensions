import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { TurnCompletion } from "../extensions/pi-slate/turn-completion.ts";

const theme = { fg: (_: string, text: string) => text } as Theme;

test("turn completion renders the elapsed label with a live theme", () => {
  const completion = new TurnCompletion(65_000, Date.now(), () => theme);
  const rows = completion.render(80);
  assert.equal(rows.length, 3);
  assert.match(rows[1]!, /Worked for 1m 5s/);
});

test("turn completion renders without color once the session ctx is stale", () => {
  // After ctx.newSession()/reload() every ctx accessor throws, so the provider yields
  // undefined; render runs inside the host paint loop and must never throw.
  const completion = new TurnCompletion(1000, Date.now(), () => undefined);
  assert.doesNotThrow(() => completion.render(80));
  assert.match(completion.render(80)[1]!, /Worked for 1s/);
  assert.deepEqual(completion.render(0), []);
});
