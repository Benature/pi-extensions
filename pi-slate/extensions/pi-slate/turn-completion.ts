import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { sidebarDuration } from "./sidebar-layout.ts";

/** UI-only turn receipt; never becomes a message in the model's context. */
export class TurnCompletion implements Component {
  private readonly label: string;

  // Undefined when the session ctx is stale after replacement; render without color.
  private readonly theme: () => Theme | undefined;

  constructor(elapsedMs: number, finishedAt: number, theme: () => Theme | undefined) {
    this.theme = theme;
    const date = new Date(finishedAt);
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    this.label = `Worked for ${sidebarDuration(elapsedMs)} • ${time}`;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return [];
    const theme = this.theme();
    return ["", truncateToWidth(theme ? theme.fg("dim", this.label) : this.label, width, "…"), ""];
  }
}
