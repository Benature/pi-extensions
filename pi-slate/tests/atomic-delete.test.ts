import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CustomEditor, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { atomicImageTokenDelete } from "../extensions/pi-slate/atomic-delete.ts";
import { installEditorPatch, installImagePlaceholders } from "../extensions/pi-slate/image-placeholders.ts";

const fixtures = mkdtempSync(join(tmpdir(), "pi-slate-atomic-delete-"));
test.after(() => rmSync(fixtures, { force: true, recursive: true }));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

// ---------------------------------------------------------------------------
// Pure helper: atomicImageTokenDelete
// ---------------------------------------------------------------------------

test("backspace right after a token removes the whole token", () => {
  const edit = atomicImageTokenDelete("see [image-1] ok", { line: 0, col: 13 }, "back");
  assert.deepEqual(edit, { text: "see  ok", cursor: { line: 0, col: 4 }, token: "[image-1]" });
});

test("backspace inside a token removes the whole token", () => {
  for (const col of [5, 8, 12]) {
    const edit = atomicImageTokenDelete("see [image-1] ok", { line: 0, col }, "back");
    assert.deepEqual(edit, { text: "see  ok", cursor: { line: 0, col: 4 }, token: "[image-1]" });
  }
});

test("backspace at the token start leaves the token alone", () => {
  assert.equal(atomicImageTokenDelete("see [image-1]", { line: 0, col: 4 }, "back"), undefined);
});

test("backspace on plain text returns undefined", () => {
  assert.equal(atomicImageTokenDelete("plain text", { line: 0, col: 5 }, "back"), undefined);
  assert.equal(atomicImageTokenDelete("[image-", { line: 0, col: 7 }, "back"), undefined);
  assert.equal(atomicImageTokenDelete("[image-1]", { line: 3, col: 9 }, "back"), undefined);
});

test("forward delete at the token start removes the whole token", () => {
  const edit = atomicImageTokenDelete("see [image-1] ok", { line: 0, col: 4 }, "forward");
  assert.deepEqual(edit, { text: "see  ok", cursor: { line: 0, col: 4 }, token: "[image-1]" });
});

test("forward delete inside a token removes the whole token", () => {
  const edit = atomicImageTokenDelete("see [image-1] ok", { line: 0, col: 9 }, "forward");
  assert.deepEqual(edit, { text: "see  ok", cursor: { line: 0, col: 4 }, token: "[image-1]" });
});

test("forward delete at the token end leaves the token alone", () => {
  assert.equal(atomicImageTokenDelete("see [image-1]", { line: 0, col: 13 }, "forward"), undefined);
});

test("token at line start and line end", () => {
  assert.deepEqual(atomicImageTokenDelete("[image-1] tail", { line: 0, col: 9 }, "back"), {
    text: " tail",
    cursor: { line: 0, col: 0 },
    token: "[image-1]",
  });
  assert.deepEqual(atomicImageTokenDelete("head [image-1]", { line: 0, col: 14 }, "back"), {
    text: "head ",
    cursor: { line: 0, col: 5 },
    token: "[image-1]",
  });
});

test("multiple tokens on one line: the touched token is removed", () => {
  const text = "[image-1] mid [image-2]";
  assert.deepEqual(atomicImageTokenDelete(text, { line: 0, col: 9 }, "back"), {
    text: " mid [image-2]",
    cursor: { line: 0, col: 0 },
    token: "[image-1]",
  });
  assert.deepEqual(atomicImageTokenDelete(text, { line: 0, col: 23 }, "back"), {
    text: "[image-1] mid ",
    cursor: { line: 0, col: 14 },
    token: "[image-2]",
  });
});

test("adjacent tokens: backspace removes the left one, forward delete the right one", () => {
  const text = "[image-1][image-2]";
  assert.deepEqual(atomicImageTokenDelete(text, { line: 0, col: 9 }, "back"), {
    text: "[image-2]",
    cursor: { line: 0, col: 0 },
    token: "[image-1]",
  });
  assert.deepEqual(atomicImageTokenDelete(text, { line: 0, col: 9 }, "forward"), {
    text: "[image-1]",
    cursor: { line: 0, col: 9 },
    token: "[image-2]",
  });
});

test("multi-line text: only the cursor line is edited", () => {
  const text = "first\nsecond [image-12] here\nthird [image-3]";
  const edit = atomicImageTokenDelete(text, { line: 1, col: 17 }, "back");
  assert.deepEqual(edit, {
    text: "first\nsecond  here\nthird [image-3]",
    cursor: { line: 1, col: 7 },
    token: "[image-12]",
  });
  // Line 2's token spans cols 6-15; forward delete at its end leaves it alone.
  assert.equal(atomicImageTokenDelete(text, { line: 2, col: 15 }, "forward"), undefined);
});

test("space variant token [image 1] is matched", () => {
  const edit = atomicImageTokenDelete("x [image 2] y", { line: 0, col: 11 }, "back");
  assert.deepEqual(edit, { text: "x  y", cursor: { line: 0, col: 2 }, token: "[image 2]" });
});

// ---------------------------------------------------------------------------
// Editor patch: installEditorPatch with a stub editor
// ---------------------------------------------------------------------------

type StubState = { text: string; cursor: { line: number; col: number } };

function stubEditor(initial: string, cursor: { line: number; col: number }) {
  const state: StubState = { text: initial, cursor };
  const passedThrough: string[] = [];
  const editor = {
    getText: () => state.text,
    getCursor: () => ({ ...state.cursor }),
    setText(text: string) {
      state.text = text;
      const lines = text.split("\n");
      state.cursor = { line: lines.length - 1, col: lines[lines.length - 1].length };
    },
    handleInput(data: string) {
      passedThrough.push(data);
      if (data === "\x1b[D") {
        if (state.cursor.col > 0) state.cursor.col -= 1;
        else if (state.cursor.line > 0) {
          state.cursor.line -= 1;
          state.cursor.col = state.text.split("\n")[state.cursor.line].length;
        }
      }
    },
    insertTextAtCursor() {},
    handlePaste() {},
  };
  return { editor: editor as unknown as CustomEditor, state, passedThrough };
}

test("patch applies atomic delete via setText and fires onTokensChanged", () => {
  const { editor, state, passedThrough } = stubEditor("see [image-1] ok", { line: 0, col: 13 });
  let notifications = 0;
  const uninstall = installEditorPatch(new Map(), () => (notifications += 1), editor);
  (editor as unknown as { handleInput(data: string): void }).handleInput("\x7f");
  assert.equal(state.text, "see  ok");
  assert.deepEqual(state.cursor, { line: 0, col: 4 });
  assert.equal(notifications, 1);
  // setText left the stub cursor at end (col 7); three synthetic lefts walk it
  // back to the token start (col 4) through the original handleInput.
  assert.deepEqual(passedThrough, ["\x1b[D", "\x1b[D", "\x1b[D"]);
  uninstall();
});

test("patch passes non-token backspace through untouched", () => {
  const { editor, state, passedThrough } = stubEditor("plain", { line: 0, col: 5 });
  let notifications = 0;
  const uninstall = installEditorPatch(new Map(), () => (notifications += 1), editor);
  (editor as unknown as { handleInput(data: string): void }).handleInput("\x7f");
  assert.equal(state.text, "plain");
  assert.deepEqual(state.cursor, { line: 0, col: 5 });
  assert.equal(notifications, 0);
  assert.deepEqual(passedThrough, ["\x7f"]);
  (editor as unknown as { handleInput(data: string): void }).handleInput("x");
  assert.deepEqual(passedThrough, ["\x7f", "x"]);
  uninstall();
});

test("uninstall restores the original handleInput", () => {
  const { editor, passedThrough } = stubEditor("[image-1]", { line: 0, col: 9 });
  const original = (editor as unknown as { handleInput(data: string): void }).handleInput;
  const uninstall = installEditorPatch(new Map(), () => {}, editor);
  uninstall();
  assert.equal((editor as unknown as { handleInput(data: string): void }).handleInput, original);
  (editor as unknown as { handleInput(data: string): void }).handleInput("\x7f");
  assert.deepEqual(passedThrough, ["\x7f"]);
});

// ---------------------------------------------------------------------------
// End-to-end with the real pi-tui Editor
// ---------------------------------------------------------------------------

function attachPlaceholders(editor: Editor) {
  const pi = { on() {}, registerMarkdownTransformer() {} } as unknown as ExtensionAPI;
  const placeholders = installImagePlaceholders(pi);
  placeholders.attachEditor(editor as unknown as CustomEditor);
  return placeholders;
}

test("real editor: one backspace removes a pasted token atomically and undo restores it", (t) => {
  const filePath = join(fixtures, "atomic.png");
  writeFileSync(filePath, PNG);
  const editor = new Editor({} as TUI, {} as EditorTheme);
  const placeholders = attachPlaceholders(editor);
  t.after(() => placeholders.dispose());

  editor.insertTextAtCursor(filePath);
  assert.equal(editor.getText(), "[image-1]");
  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  editor.handleInput("\x1f"); // ctrl+- (undo)
  assert.equal(editor.getText(), "[image-1]");
});

test("real editor: backspace after a token keeps surrounding text and places cursor at token start", (t) => {
  const editor = new Editor({} as TUI, {} as EditorTheme);
  const placeholders = attachPlaceholders(editor);
  t.after(() => placeholders.dispose());

  editor.setText("a [image-1] b");
  editor.handleInput("\x1b[D"); // before "b"
  editor.handleInput("\x1b[D"); // right after "]"
  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "a  b");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
  editor.handleInput("\x1f"); // single undo restores the whole token
  assert.equal(editor.getText(), "a [image-1] b");
});

test("real editor: forward delete at token start removes the whole token", (t) => {
  const editor = new Editor({} as TUI, {} as EditorTheme);
  const placeholders = attachPlaceholders(editor);
  t.after(() => placeholders.dispose());

  editor.setText("a [image-1] b");
  editor.handleInput("\x01"); // ctrl+a: line start
  editor.handleInput("\x1b[C");
  editor.handleInput("\x1b[C"); // at "["
  editor.handleInput("\x1b[3~");
  assert.equal(editor.getText(), "a  b");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
});

test("real editor: multi-line token deletion moves the cursor across lines", (t) => {
  const editor = new Editor({} as TUI, {} as EditorTheme);
  const placeholders = attachPlaceholders(editor);
  t.after(() => placeholders.dispose());

  editor.setText("first\nsecond [image-2] here\nthird");
  editor.handleInput("\x1b[A"); // line 1
  editor.handleInput("\x05"); // ctrl+e: end of line 1 (col 21)
  for (let i = 0; i < 5; i += 1) editor.handleInput("\x1b[D"); // right after "]" (col 16)
  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "first\nsecond  here\nthird");
  assert.deepEqual(editor.getCursor(), { line: 1, col: 7 });
  editor.handleInput("\x1f");
  assert.equal(editor.getText(), "first\nsecond [image-2] here\nthird");
});

test("real editor: normal backspace on plain text is unaffected", (t) => {
  const editor = new Editor({} as TUI, {} as EditorTheme);
  const placeholders = attachPlaceholders(editor);
  t.after(() => placeholders.dispose());

  editor.setText("abc");
  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "ab");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
});

test("real editor: deleting a token preserves the bracketed-paste registry", (t) => {
  const filePath = join(fixtures, "paste-reg.png");
  writeFileSync(filePath, PNG);
  const editor = new Editor({} as TUI, {} as EditorTheme);
  const placeholders = attachPlaceholders(editor);
  t.after(() => placeholders.dispose());

  const bigPaste = "x".repeat(1500);
  editor.handleInput(`\x1b[200~${bigPaste}\x1b[201~`);
  assert.match(editor.getText(), /\[paste #1 /);
  editor.insertTextAtCursor(filePath);
  assert.match(editor.getText(), /\[image-1\]$/);
  editor.handleInput("\x7f");
  // setText would normally clear the paste registry and orphan the marker;
  // the patch preserves it so the marker still expands to the pasted content.
  assert.ok(editor.getExpandedText().includes(bigPaste));
  assert.doesNotMatch(editor.getExpandedText(), /\[paste #1 /);
});

test("real editor: deleting a token keeps re-paste numbering intact", (t) => {
  const first = join(fixtures, "first.png");
  const second = join(fixtures, "second.png");
  writeFileSync(first, PNG);
  writeFileSync(second, PNG);
  const editor = new Editor({} as TUI, {} as EditorTheme);
  const placeholders = attachPlaceholders(editor);
  t.after(() => placeholders.dispose());

  editor.insertTextAtCursor(first);
  assert.equal(editor.getText(), "[image-1]");
  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "");
  editor.insertTextAtCursor(second);
  // Numbering comes from scanning the current text, so re-paste reuses 1.
  assert.equal(editor.getText(), "[image-1]");
});
