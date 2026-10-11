import { readFileSync, statSync } from "node:fs";
import type { CustomEditor, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, matchesKey } from "@earendil-works/pi-tui";
import { atomicImageTokenDelete, type Cursor } from "./atomic-delete.ts";
import { ImagePeek } from "./image-peek.ts";
import {
  mimeTypeForImagePath,
  nextImageNumber,
  rewriteClipboardPaths,
  transformSubmittedText,
  type ImageAttachment,
  type ImagePathStore,
} from "./placeholders.ts";
import type { Sidebar } from "./sidebar.ts";

type PatchableEditor = {
  insertTextAtCursor(text: string): void;
  handlePaste(text: string): void;
  handleInput(data: string): void;
  setText(text: string): void;
  // Editor internals. jumpMode/isInPaste are read only to avoid intercepting
  // keys the editor routes elsewhere; pastes/pasteCounter are preserved across
  // setText (which would otherwise clear the bracketed-paste registry and
  // orphan "[paste #N]" markers already in the text).
  jumpMode?: unknown;
  isInPaste?: boolean;
  pastes?: Map<number, string>;
  pasteCounter?: number;
};

export type ImagePlaceholders = {
  attachEditor(editor: CustomEditor): void;
  detachEditor(): void;
  dispose(): void;
};

function loadImage(filePath: string): ImageAttachment | undefined {
  try {
    if (!statSync(filePath).isFile()) return undefined;
    return {
      type: "image",
      data: readFileSync(filePath).toString("base64"),
      mimeType: mimeTypeForImagePath(filePath),
    };
  } catch {
    return undefined;
  }
}

// Match exactly the inputs the editor maps to single-character deletion
// (see handleInput in @earendil-works/pi-tui components/editor.js).
function atomicDeleteDirection(data: string): "back" | "forward" | undefined {
  const kb = getKeybindings();
  if (kb.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, "shift+backspace")) return "back";
  if (kb.matches(data, "tui.editor.deleteCharForward") || matchesKey(data, "shift+delete")) return "forward";
  return undefined;
}

const LEFT_ARROW = "\x1b[D";
const CTRL_B = "\x02";

/** A keypress the editor will treat as cursor-left, respecting custom keybindings. */
function moveLeftKey(): string | undefined {
  const kb = getKeybindings();
  if (kb.matches(LEFT_ARROW, "tui.editor.cursorLeft")) return LEFT_ARROW;
  if (kb.matches(CTRL_B, "tui.editor.cursorLeft")) return CTRL_B;
  return undefined;
}

/**
 * setText() leaves the cursor at the end of the text. Walk it back to the
 * target by replaying cursor-left keypresses through the original handler
 * (grapheme-aware, wraps across logical lines), checking getCursor() after
 * each step so segmentation quirks cannot overshoot silently.
 */
function moveCursorTo(
  editor: CustomEditor,
  target: Cursor,
  text: string,
  handleInput: PatchableEditor["handleInput"],
): void {
  const key = moveLeftKey();
  if (!key) return;
  // Upper bound: every left keypress moves at least one column or one line.
  let steps = text.length + text.split("\n").length + 1;
  while (steps-- > 0) {
    const cursor = editor.getCursor();
    if (cursor.line === target.line && cursor.col === target.col) return;
    if (cursor.line < target.line || (cursor.line === target.line && cursor.col < target.col)) return;
    handleInput.call(editor, key);
  }
}

export function installEditorPatch(
  store: ImagePathStore,
  onTokensChanged: () => void,
  editor: CustomEditor,
): () => void {
  const instance = editor as unknown as PatchableEditor;
  const originalInsert = instance.insertTextAtCursor;
  const originalPaste = instance.handlePaste;
  const originalHandleInput = instance.handleInput;
  const rewrite = (editor: CustomEditor, text: string) => rewriteClipboardPaths(text, nextImageNumber(editor.getText()), store);
  function insertPatch(this: CustomEditor, text: string) {
    const result = originalInsert.call(this, rewrite(this, text));
    onTokensChanged();
    return result;
  }
  function pastePatch(this: CustomEditor, text: string) {
    originalPaste.call(this, rewrite(this, text));
    onTokensChanged();
  }
  function handleInputPatch(this: CustomEditor, data: string) {
    const direction = atomicDeleteDirection(data);
    if (direction && !instance.isInPaste) {
      const edit = atomicImageTokenDelete(this.getText(), this.getCursor(), direction);
      if (edit) {
        // Mirror the editor: a control key cancels an armed jump mode and
        // falls through to normal handling — the atomic delete is that handling.
        if (instance.jumpMode != null) instance.jumpMode = null;
        // One setText = one undo snapshot, so a single undo restores the
        // whole token (never a partial token).
        const pastes = instance.pastes;
        const savedPastes = pastes instanceof Map && pastes.size > 0 ? new Map(pastes) : undefined;
        const pasteCounter = instance.pasteCounter;
        instance.setText(edit.text);
        if (savedPastes && instance.pastes instanceof Map && instance.pastes.size === 0) {
          instance.pastes = savedPastes;
          if (typeof pasteCounter === "number") instance.pasteCounter = pasteCounter;
        }
        moveCursorTo(this, edit.cursor, edit.text, originalHandleInput);
        onTokensChanged();
        return;
      }
    }
    return originalHandleInput.call(this, data);
  }
  instance.insertTextAtCursor = insertPatch;
  instance.handlePaste = pastePatch;
  instance.handleInput = handleInputPatch;
  return () => {
    if (instance.insertTextAtCursor === insertPatch) instance.insertTextAtCursor = originalInsert;
    if (instance.handlePaste === pastePatch) instance.handlePaste = originalPaste;
    if (instance.handleInput === handleInputPatch) instance.handleInput = originalHandleInput;
  };
}

export function installImagePlaceholders(
  pi: ExtensionAPI,
  workspace?: Sidebar,
  isActive: () => boolean = () => true,
): ImagePlaceholders {
  const store: ImagePathStore = new Map();
  let peek: ImagePeek | undefined;
  let uninstallEditorPatch: (() => void) | undefined;

  pi.on("input", async (event, ctx) => {
    if (ctx.mode !== "tui" || !uninstallEditorPatch || !isActive()) return;
    peek?.hide();
    const result = transformSubmittedText(event.text, store, loadImage, event.images ?? []);
    if (result.text === event.text && result.images.length === (event.images?.length ?? 0)) {
      return { action: "continue" as const };
    }
    return {
      action: "transform" as const,
      text: result.text,
      images: result.images,
    };
  });

  return {
    attachEditor(editor) {
      this.detachEditor();
      uninstallEditorPatch = installEditorPatch(store, () => peek?.rewrite(), editor);
      peek = new ImagePeek(store, editor, workspace, loadImage);
    },
    detachEditor() {
      peek?.dispose();
      peek = undefined;
      uninstallEditorPatch?.();
      uninstallEditorPatch = undefined;
    },
    dispose() {
      this.detachEditor();
      store.clear();
    },
  };
}
