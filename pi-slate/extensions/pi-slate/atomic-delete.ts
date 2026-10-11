// Atomic deletion of `[image-N]` placeholder tokens.
//
// Pure helper shared by the editor patch: given the full editor text, a cursor
// position, and a delete direction, decide whether the keypress touches an
// image token. When it does, the whole token is removed at once (OpenCode /
// Claude Code behavior) instead of a single character.

const IMAGE_TOKEN_RE = /\[image[ -]\d+\]/g;

export type Cursor = { line: number; col: number };

export type AtomicTokenDelete = {
  /** Full editor text with the token removed. */
  text: string;
  /** Cursor lands at the start of the removed token. */
  cursor: Cursor;
  /** The token that was removed, e.g. "[image-1]". */
  token: string;
};

/**
 * Return the atomic edit for a backspace/forward-delete at `cursor`, or
 * undefined when the keypress does not touch an image token.
 *
 * Touching means:
 * - "back":    cursor column in (tokenStart, tokenEnd]  (cursor at the token
 *              start deletes the character before the token instead)
 * - "forward": cursor column in [tokenStart, tokenEnd)  (cursor at the token
 *              end deletes the character after the token instead)
 *
 * Tokens are ASCII and never span lines; all other lines are preserved.
 */
export function atomicImageTokenDelete(
  text: string,
  cursor: Cursor,
  direction: "back" | "forward",
): AtomicTokenDelete | undefined {
  const lines = text.split("\n");
  const line = lines[cursor.line];
  if (line === undefined) return undefined;
  for (const match of line.matchAll(IMAGE_TOKEN_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    const touches =
      direction === "back"
        ? cursor.col > start && cursor.col <= end
        : cursor.col >= start && cursor.col < end;
    if (!touches) continue;
    lines[cursor.line] = line.slice(0, start) + line.slice(end);
    return { text: lines.join("\n"), cursor: { line: cursor.line, col: start }, token: match[0] };
  }
  return undefined;
}
