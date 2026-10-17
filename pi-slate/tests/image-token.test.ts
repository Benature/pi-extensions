import assert from "node:assert/strict";
import test from "node:test";
import type { CustomEditor, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { imageTokenEnclosing, snapCursorOutOfToken } from "../extensions/pi-slate/atomic-delete.ts";
import { paintImageTokenAtCaret, paintImageTokenAtCaretLines } from "../extensions/pi-slate/composer.ts";
import { installEditorPatch, installImagePlaceholders } from "../extensions/pi-slate/image-placeholders.ts";

// ---------------------------------------------------------------------------
// Pure helper: imageTokenEnclosing
// ---------------------------------------------------------------------------

test("interior caret is inside the token, boundaries are not", () => {
  const text = "see [image-1] ok"; // token spans cols 4..12, end 13
  assert.deepEqual(imageTokenEnclosing(text, { line: 0, col: 8 }), { start: 4, end: 13, token: "[image-1]" });
  assert.equal(imageTokenEnclosing(text, { line: 0, col: 4 }), undefined, "start boundary");
  assert.equal(imageTokenEnclosing(text, { line: 0, col: 13 }), undefined, "end boundary");
  assert.equal(imageTokenEnclosing("plain text", { line: 0, col: 3 }), undefined);
  assert.equal(imageTokenEnclosing(text, { line: 1, col: 8 }), undefined, "other lines ignored");
});

test("space variant [image 1] interior is detected", () => {
  assert.deepEqual(imageTokenEnclosing("x [image 2] y", { line: 0, col: 5 }), { start: 2, end: 11, token: "[image 2]" });
});

// ---------------------------------------------------------------------------
// Pure helper: snapCursorOutOfToken
// ---------------------------------------------------------------------------

test("interior caret snaps to the nearest token boundary", () => {
  const text = "see [image-1] ok"; // token 4..13
  assert.deepEqual(snapCursorOutOfToken(text, { line: 0, col: 5 }), { line: 0, col: 4 });
  assert.deepEqual(snapCursorOutOfToken(text, { line: 0, col: 12 }), { line: 0, col: 13 });
});

test("a tie snaps to the token start", () => {
  // "[image-12]" spans cols 0..10; col 5 is equidistant from both boundaries.
  assert.deepEqual(snapCursorOutOfToken("[image-12]", { line: 0, col: 5 }), { line: 0, col: 0 });
});

test("caret outside a token is unchanged", () => {
  for (const col of [0, 4, 13, 16]) {
    assert.deepEqual(snapCursorOutOfToken("see [image-1] ok", { line: 0, col }), { line: 0, col });
  }
});

// ---------------------------------------------------------------------------
// Pure helper: paintImageTokenAtCaret
// ---------------------------------------------------------------------------

test("caret on the token's [ repaints the whole token as one unit", () => {
  const line = "    see \x1b[7m[\x1b[0mimage-1] ok   ";
  assert.equal(paintImageTokenAtCaret(line), "    see \x1b[7m[image-1]\x1b[27m ok   ");
});

test("Pi 1.3 fake-cursor caret on [ repaints the whole token as one unit", () => {
  const line = "see \x1b_pi:fc\x07[\x1b_pi:/fc\x07image-1] ok";
  assert.equal(paintImageTokenAtCaret(line), "see \x1b[7m[image-1]\x1b[27m ok");
});

test("caret just past the token end is a normal caret", () => {
  const line = "    see [image-1]\x1b[7m \x1b[0m";
  assert.equal(paintImageTokenAtCaret(line), line);
});

test("space variant token is repainted whole", () => {
  const line = "x \x1b[7m[\x1b[0mimage 1] y";
  assert.equal(paintImageTokenAtCaret(line), "x \x1b[7m[image 1]\x1b[27m y");
});

test("caret on the character after the token's trailing space does not highlight it", () => {
  const line = "[image-1] \x1b[7mo\x1b[0mk";
  assert.equal(paintImageTokenAtCaret(line), line);
});

test("caret on the space right after the token is a normal caret", () => {
  const line = "[image-1]\x1b[7m \x1b[0mok";
  assert.equal(paintImageTokenAtCaret(line), line);
});

test("caret next to the token on the left does not highlight it", () => {
  const line = "se\x1b[7me\x1b[0m [image-1] ok";
  assert.equal(paintImageTokenAtCaret(line), line);
});

test("adjacent tokens: the token starting at the caret wins", () => {
  const line = "[image-1]\x1b[7m[\x1b[0mimage-2]";
  assert.equal(paintImageTokenAtCaret(line), "[image-1]\x1b[7m[image-2]\x1b[27m");
});

test("non-image bracketed text is left alone", () => {
  const line = "see \x1b[7m[\x1b[0mpaste #1] ok";
  assert.equal(paintImageTokenAtCaret(line), line);
  const plain = "no caret here [image-1]";
  assert.equal(paintImageTokenAtCaret(plain), plain);
});

test("IME cursor marker after the token does not highlight it", () => {
  const line = "a [image-1]\x1b_pi:c\x07\x1b[7m \x1b[0m";
  assert.equal(paintImageTokenAtCaret(line), line);
});

test("paintImageTokenAtCaretLines only touches the caret line", () => {
  const lines = ["border", "see \x1b[7m[\x1b[0mimage-1] ok", "border"];
  assert.deepEqual(paintImageTokenAtCaretLines(lines), ["border", "see \x1b[7m[image-1]\x1b[27m ok", "border"]);
  const noCaret = ["border", "see [image-1] ok", "border"];
  assert.equal(paintImageTokenAtCaretLines(noCaret), noCaret, "array returned as-is without a caret");
});

// ---------------------------------------------------------------------------
// Editor patch: caret snapping with a stub editor
// ---------------------------------------------------------------------------

function stubEditor(initial: string, cursor: { line: number; col: number }) {
  const state = { text: initial, cursor };
  const editor = {
    getText: () => state.text,
    getCursor: () => ({ ...state.cursor }),
    setText(text: string) {
      state.text = text;
      const lines = text.split("\n");
      state.cursor = { line: lines.length - 1, col: lines[lines.length - 1]!.length };
    },
    handleInput(data: string) {
      const lines = state.text.split("\n");
      if (data === "\x1b[D") {
        if (state.cursor.col > 0) state.cursor.col -= 1;
        else if (state.cursor.line > 0) {
          state.cursor.line -= 1;
          state.cursor.col = lines[state.cursor.line]!.length;
        }
      } else if (data === "\x1b[C") {
        if (state.cursor.col < lines[state.cursor.line]!.length) state.cursor.col += 1;
        else if (state.cursor.line < lines.length - 1) {
          state.cursor.line += 1;
          state.cursor.col = 0;
        }
      } else if (data.length === 1 && data >= " ") {
        const line = lines[state.cursor.line]!;
        lines[state.cursor.line] = line.slice(0, state.cursor.col) + data + line.slice(state.cursor.col);
        state.text = lines.join("\n");
        state.cursor.col += 1;
      }
    },
    handleMouse(_event: TuiMouseEvent) {
      // A click lands mid-token.
      state.cursor = { line: 0, col: 8 };
      return { handled: true as const, focus: true };
    },
    insertTextAtCursor() {},
    handlePaste() {},
  };
  return { editor: editor as unknown as CustomEditor, state };
}

test("stub: a printable keypress cannot land inside a token", () => {
  const { editor, state } = stubEditor("see [image-1] ok", { line: 0, col: 8 });
  const uninstall = installEditorPatch(new Map(), () => {}, editor);
  (editor as unknown as { handleInput(data: string): void }).handleInput("x");
  assert.equal(state.text, "see x[image-1] ok", "inserts at the token start, not inside");
  assert.deepEqual(state.cursor, { line: 0, col: 5 });
  uninstall();
});

test("stub: a click inside a token snaps the caret out", () => {
  const { editor, state } = stubEditor("see [image-1] ok", { line: 0, col: 0 });
  const uninstall = installEditorPatch(new Map(), () => {}, editor);
  const result = (editor as unknown as { handleMouse(e: unknown): unknown }).handleMouse({ type: "click", button: "left" });
  assert.deepEqual(result, { handled: true, focus: true }, "mouse result passes through");
  assert.deepEqual(state.cursor, { line: 0, col: 4 }, "col 8 snaps to the nearer (start) boundary");
  uninstall();
});

test("stub: right arrow from the token start jumps to the token end", () => {
  const { editor, state } = stubEditor("see [image-1] ok", { line: 0, col: 4 });
  const uninstall = installEditorPatch(new Map(), () => {}, editor);
  (editor as unknown as { handleInput(data: string): void }).handleInput("\x1b[C");
  assert.deepEqual(state.cursor, { line: 0, col: 13 });
  uninstall();
});

test("stub: left arrow from the token end jumps to the token start", () => {
  const { editor, state } = stubEditor("see [image-1] ok", { line: 0, col: 13 });
  const uninstall = installEditorPatch(new Map(), () => {}, editor);
  (editor as unknown as { handleInput(data: string): void }).handleInput("\x1b[D");
  assert.deepEqual(state.cursor, { line: 0, col: 4 });
  uninstall();
});

// ---------------------------------------------------------------------------
// End-to-end with the real pi-tui Editor
// ---------------------------------------------------------------------------

function realEditor() {
  const editor = new Editor({ terminal: { rows: 30 } } as unknown as TUI, { borderColor: (s: string) => s } as unknown as EditorTheme);
  const pi = { on() {}, registerMarkdownTransformer() {} } as unknown as ExtensionAPI;
  const placeholders = installImagePlaceholders(pi);
  placeholders.attachEditor(editor as unknown as CustomEditor);
  return { editor, placeholders };
}

test("real editor: one right keypress from the token start lands at the token end", (t) => {
  const { editor, placeholders } = realEditor();
  t.after(() => placeholders.dispose());
  editor.setText("a [image-1] b"); // token spans cols 2..10, end 11
  editor.handleInput("\x01"); // line start
  editor.handleInput("\x1b[C");
  editor.handleInput("\x1b[C"); // token start (col 2)
  editor.handleInput("\x1b[C");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 11 }, "interior skipped in one press");
  editor.handleInput("\x1b[C");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 12 }, "next press moves on");
});

test("real editor: one left keypress from the token end lands at the token start", (t) => {
  const { editor, placeholders } = realEditor();
  t.after(() => placeholders.dispose());
  editor.setText("a [image-1] b");
  editor.handleInput("\x1b[D"); // col 12
  editor.handleInput("\x1b[D"); // token end (col 11)
  editor.handleInput("\x1b[D");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 }, "interior skipped in one press");
  editor.handleInput("\x1b[D");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 1 }, "next press moves on");
});

test("real editor: jump-to-char into a token interior snaps to the start boundary", (t) => {
  const { editor, placeholders } = realEditor();
  t.after(() => placeholders.dispose());
  editor.setText("a [image-1] b"); // "m" sits at col 4, inside token 2..11
  editor.handleInput("\x01"); // line start
  editor.handleInput("\x1d"); // ctrl+] arms jump-forward
  editor.handleInput("m");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
});

test("real editor: caret at the token start paints the whole token in the render", (t) => {
  const { editor, placeholders } = realEditor();
  t.after(() => placeholders.dispose());
  editor.setText("see [image-1] ok");
  editor.handleInput("\x01"); // line start
  for (let i = 0; i < 4; i += 1) editor.handleInput("\x1b[C"); // token start (col 4)
  const raw = editor.render(60);
  const caretLine = raw.find((line) => line.includes("\x1b_pi:fc\x07") || line.includes("\x1b[7m"));
  assert.ok(caretLine, "editor paints a caret cell");
  const painted = paintImageTokenAtCaretLines(raw);
  const paintedLine = painted.find((line) => line.includes("\x1b[7m[image-1]\x1b[27m"));
  assert.ok(paintedLine, "whole token highlighted as one unit");
  assert.equal(strip(paintedLine!), strip(caretLine!), "paint changes styling only, not text");
});

test("real editor: caret at the token end is a normal caret", (t) => {
  const { editor, placeholders } = realEditor();
  t.after(() => placeholders.dispose());
  editor.setText("see [image-1] ok"); // token 4..12, end 13; caret starts at col 16
  editor.handleInput("\x1b[D");
  editor.handleInput("\x1b[D"); // col 14, on "o"
  editor.handleInput("\x1b[D"); // col 13, the token end boundary
  const painted = paintImageTokenAtCaretLines(editor.render(60));
  assert.ok(!painted.some((row) => row.includes("\x1b[7m[image-1]\x1b[27m")), "caret after the token is not an object highlight");
});

function strip(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_[^\x07]*\x07/g, "");
}
