<h1 align="center">Slate 🌱</h1>

<p align="center">
  A minimal-TUI with rich-graphics support that adds zero-context bloat
</p>

![Slate workspace](https://raw.githubusercontent.com/GaganSD/pi-extensions/main/pi-slate/assets/slate-overview.png)

## Setup

**Bash**

```bash
pi install npm:pi-slate
```

Explore extension settings using `/slate` after installation. Releases: [CHANGELOG](CHANGELOG.md).

## Requirements

- Pi Coding Agent and a modern terminal that can render Kitty or iTerm2 image protocol, such as Ghostty or Warp.
- Keep other UI extensions enabled and select only the surfaces you want Slate to own. Same-slot writers follow host precedence; no automatic conflict repair.
- Copy a bug report with `/slate bug`.


## Independent Surfaces

Slate can own one surface and leave the rest untouched. The closed set is `header`, `footer`, `editor`, `sidebar`, `tool-cards`, `transcript`.

Changes are saved and require `/reload`; appearance settings stay live. A fresh install selects `["editor", "sidebar", "tool-cards"]`.

| Surface | Owns |
| --- | --- |
| `header` | Compact workspace identity and update hairline |
| `footer` | Zero-row footer (hides Pi's native footer) |
| `editor` | Composer, keys, paste/images, working/thinking status |
| `sidebar` | Session dashboard, resources, tasks and images |
| `tool-cards` | Highlighted edit/write cards and grouped reads |
| `transcript` | Visible-message window |

## Features

Slate renders cleanly into your terminal and stays customizable without adding new model-facing tools, prompts, or model calls.

### Quiet Workbench

The header keeps the stock Pi settings and data then builds on it. For the full workbench: `/slate surfaces full`, `/slate focused off`, then `/reload`. 

- `/slate focused [on|off]` hides or restores the sidebar; fresh settings start focused.
- `/slate pid [on|off]` toggles a prompt-edge PID label, off by default.
- `/slate progress [waves|dna-helix|snake|cylon-scanner]` picks the prompt-edge working animation.
- Below 100 columns or 30 rows, the rail hides and its facts move onto the prompt frame; `/slate session` still shows full details.

![Slate focused mode with the sidebar hidden](https://raw.githubusercontent.com/GaganSD/pi-extensions/main/pi-slate/assets/slate-focused.png)

### Thinking Status

With `editor` selected, an observed thinking block adds elapsed seconds and the estimated token rate to the prompt-edge working word: `Pondering · 7s · ↑↓42`. The timer stops when thinking ends, aborts, or the session shuts down. Native thinking labels and `Ctrl+T` remain untouched.

### Working Indicator

While the model runs, the composer edge shows a progress animation instead of the italic working word: `waves` (default), `dna-helix`, `snake`, or `cylon-scanner`. `/slate progress` picks the style and applies it immediately.

### Diff

With `tool-cards` selected, `edit` and `write` results are syntax-highlighted in the transcript.

![Split YAML edit with word-level emphasis](https://raw.githubusercontent.com/GaganSD/pi-extensions/main/pi-slate/assets/slate-diff-yaml.png)

![Split Rust edit with syntax highlighting](https://raw.githubusercontent.com/GaganSD/pi-extensions/main/pi-slate/assets/slate-diff-rust.png)

### Claude Code Tool Style (opt-in)

![Slate Claude Code-style tool transcript with grouped calls, edit counts, and an intentional demo failure](https://raw.githubusercontent.com/GaganSD/pi-extensions/main/pi-slate/assets/slate-claudecode-tools.png)

Set `"toolStyle": "claudecode"` in `~/.pi/agent/pi-slate.json`, keep `tool-cards` selected, then `/reload`.

- Compact `✓ Name (args)` calls with `└` result summaries, duration, and green/red edit counts. Pending/running/error states stay visible.
- Consecutive calls group into `Done (…)` / `Running (…)` trees in compatible fullscreen hosts; expanding any member restores the individual cards.
- Covers read, bash, grep, find, ls, write, edit, apply_patch, codemode, and recall without registering replacement tools. Slate's expanded diff views still apply; model-facing results are unchanged.

Requires a host with `registerToolRenderer`; older or non-fullscreen hosts keep the default cards. Switching styles requires `/reload`.

### Rich Media Rendering

Slate uses Kitty Graphics Protocol to display rich media inside your terminal.

> Usage: Caret-peek over image tokens to display. `[image-N]` is a single object — the caret cannot enter it, and the whole token highlights. Open or copy from the image shelf, or double-click the image to open it. The peek leaves when the caret does. Task inspection never replaces the image. Pi-generated clipboard image paths are converted into `[image-N]` tokens.

![Chat with image tokens and the sidebar image preview](https://raw.githubusercontent.com/GaganSD/pi-extensions/main/pi-slate/assets/slate-media.png)

### Session Dashboard

The sidebar keeps session facts visible without sending them to a model:

- Session id and PID (click to copy), model/thinking, and a context meter with merged tokens, cost and rate (`188k / 500k · $0.71 · ~420/s`), followed by cached/uncached usage rows. `/slate session` shows full accounting.
- Foldable **MCP servers**, **Skills** and **Prompts** lists with counts. MCP states describe configuration, not live connectivity; credentials are never displayed.
- Background tasks and an image shelf appear only when nonempty. Click a task or image to inspect it in a scrolling dialog.

Focused and compact modes hide the dashboard; its facts move onto the prompt frame.

### Background Tasks & Subagents

Other extensions can publish detached terminals or jobs to the sidebar's task shelf through the `pi:background-tasks` event on Pi's event bus; snapshots are display-only and cleared with their session. With `editor` and a fullscreen `sidebar` selected, Slate can also lend the sidebar's chat slot to a pi-subagents worker conversation — a UI-only handshake with no new model tools — and restores the same surfaces on return. Without a compatible slot, pi-subagents uses its own fallback.

### Themes

Slate supports the following themes and can be changed with `/slate theme <name>`:

- `tokyo-night` ⬛🟦🟪🟩
- `quiet` ⬛⬜🟥🟨
- `mauve` ⬛🟪🟥🟨
- `sapphire` ⬛🟦🟥🟨
- `peach` ⬛🟧🟥🟨
- `teal` ⬛🟩🟥🟨
- `default` restores Pi's system theme. Black Metal remains available in Pi's theme settings.

Selection is saved and also appears in `/settings`.

### Prompt Templates

With `editor` selected, `/prompts` (or `Ctrl+Alt+P`) opens a searchable picker of Pi's prompt templates; Enter inserts at the composer cursor.

![Slate prompt template picker](https://raw.githubusercontent.com/GaganSD/pi-extensions/main/pi-slate/assets/slate-prompts.png)

### Composer Keys

These work when `editor` is selected. No terminal configuration.

| Action | Keys |
| --- | --- |
| Select all prompt text | `Ctrl+A` |
| Copy the prompt | `Ctrl+C` |
| Scroll a long prompt | Mouse wheel over the composer |
| Replace or drop a large prompt | `Ctrl+A` then Backspace, or `Esc` `Esc` |
| Submit selected prompt | `Enter` |
| Clear the prompt | `Esc` `Esc` |
| Expand or collapse a paste | Click the `[paste #N]` token |

## Commands

`/slate` with no args opens the settings picker. `/prompts` is registered only with `editor` selected. `/exit` always quits Pi, same as `/quit`.

| Setting | Commands | Effect |
| --- | --- | --- |
| Surfaces | `/slate surfaces [set <names...>\|full\|none]` | Show or save the selected set; requires `/reload`. |
| Focused | `/slate focused [on\|off]` | Set focused mode. Focused mode hides the sidebar; standard mode restores it. |
| PID display | `/slate pid [on\|off]` | Show the agent process ID on the composer's top edge. Off by default; omitted when the frame is too narrow. |
| Working indicator | `/slate progress [waves\|dna-helix\|snake\|cylon-scanner]` | Animate the composer's working-status slot. `waves` is the default. |
| Sidebar width | `/slate width [default\|narrow\|medium\|wide\|<percent>]` | Choose the sidebar width and return to standard mode. `default` is 20%. |
| Session dashboard | `/slate session [mcp\|skills\|commands\|tasks\|image]` | Inspect facts, expand/collapse resources, insert commands, or manage the image shelf. |
| Message length | `/slate message-length [default\|all\|<count>]` | How many chat messages stay on screen. `default` is 100. |
| Density | `/slate density [comfortable\|compact]` | Comfortable shows a › prompt in the composer; compact is tighter. |
| Composer metadata | `/slate footer [standard\|minimal]` | Legacy command alias: standard shows model and thinking on the composer; minimal hides them. Not footer-slot ownership. |
| Theme | `/slate theme [default\|tokyo-night\|quiet\|mauve\|sapphire\|peach\|teal]` | Default restores Pi's system theme. Tokyo Night is explicit; other styles select Catppuccin; `/slate style` retains Catppuccin aliases. |
| Bugs | `/slate bug [file\|open]` | Copy a bug report, or open the npm package page. |

## Model Display

`~/.pi/agent/pi-slate.json` accepts a `modelDisplay` object to restyle model labels in the header and composer footer. It is provider-agnostic and display-only; the model id sent to the API never changes.

```json
{
  "modelDisplay": {
    "stripPrefixes": ["us.", "eu.", "global.", "anthropic.", "xai.", "moonshotai."],
    "providerAliases": { "bedrock-runtime": "bedrock", "bedrock-priority": "bedrock" },
    "providerSuffix": true
  }
}
```

- `stripPrefixes`: literal prefixes removed from displayed model ids, applied repeatedly. `us.moonshotai.kimi-k3` becomes `kimi-k3`.
- `providerAliases`: renames a provider for display. Aliased providers collapse to the same label.
- `providerSuffix`: renders `kimi-k3 (bedrock)` instead of `bedrock/kimi-k3` in both the header and the footer.

## License

[MIT](LICENSE) © [Gagan Devagiri](https://github.com/GaganSD)
