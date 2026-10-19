import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { sidebarDuration } from "./sidebar-layout.ts";

/** UI-only turn receipt; never becomes a message in the model's context. */
export class TurnCompletion implements Component {
  private readonly label: string;

  private readonly theme: () => Theme;

  constructor(elapsedMs: number, finishedAt: number, theme: () => Theme) {
    this.theme = theme;
    const date = new Date(finishedAt);
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    this.label = `Worked for ${sidebarDuration(elapsedMs)} • ${time}`;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return [];
    return ["", truncateToWidth(this.theme().fg("dim", this.label), width, "…"), ""];
  }
}
