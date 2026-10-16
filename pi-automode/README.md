# pi-automode

A local permission gate for [Pi](https://pi.dev). Let ordinary workspace file
operations run; approve other actions one at a time.

**Beta · macOS and Linux · Node 22.19+ · tested with Pi 1.1.0**

## Quick start

```sh
pi install npm:@gagansd/pi-automode
```

Restart Pi or run `/reload`, then:

```text
/automode on
```

Confirm **Turn on** in the terminal. No API key, classifier, or rules are
required. Automode starts **off** on first install; your choice is saved.

When an action needs permission, choose **Allow once**, **Decline**, or
**Inspect details**. Escape cancels without granting permission. An explicit
Decline also suppresses identical retries for the rest of that session.

To stop checking, run `/automode off` and confirm. Pending approvals are
cancelled, not executed. New calls then run without Automode checks.

## What happens while on

| Action | Behavior |
|---|---|
| Ordinary `read`, `edit`, or `write` inside the workspace | Runs automatically when its target can be verified |
| Writes to protected locations | Blocked |
| Sensitive reads, outside-workspace files, or uncertain targets | Ask for local approval |
| `bash` commands | Ask, unless a narrowly supported exact allow rule applies; exact block rules block |
| Other tools, including codemode, MCP, custom tools, and nested calls | Blocked |

Protected locations include the Pi agent directory, project `.pi`, Git
metadata, CI configuration, this extension, and secret/key paths. Command
rules do not override these file protections. An enabled message block rule
makes otherwise allowed actions ask too; see [Rules](#rules).

**Not a sandbox.** An approved shell command runs with your full user
permissions, including access to files, network, and child processes.
Automode cannot undo actions already started.

## Commands

| Command | Use |
|---|---|
| `/automode` | Open the compact panel: toggle, rules, logs, optional classifier, details |
| `/automode on` | Enable checks after confirmation |
| `/automode off` | Disable checks after confirmation |
| `/automode rules` | Add or manage rules |
| `/automode logs` | View recorded decisions, newest first |

The footer shows only on, off, or halted. **Details** contains coverage,
queue counts, settings location, and log limits.
If configuration changes unexpectedly, checks halt; inspect the settings,
then choose **Re-verify configuration** in the panel. Changes and approvals
require Pi's interactive terminal, not RPC or print mode.

## Rules

You do not need rules to get started. Add them only to reduce repeated
approvals or explicitly block an invocation.

Open `/automode rules`, choose **Add rule**, then choose an effect and type:

- **Allow command** / **Block command** match the entire command exactly,
  including whitespace. Block rules take priority.
- An allow rule only skips approval for a narrowly verified read-only shell
  invocation. Scripts, interpreters, package managers, Git commands, and
  compositions still ask, even with a matching rule.
- **Message rules are experimental.** Allow messages never auto-approve.
  An enabled block message makes **all otherwise allowed actions ask**,
  because local policy cannot interpret the instruction and the optional
  classifier cannot authorize anything.

For example, allowing `ls -la` does not allow `ls -la; rm -rf dist`.
Rules can be edited, disabled, moved between allow/block, or deleted.

## Optional classifier

You can skip this entirely. It adds **shadow review**, not automatic approval.

In `/automode`, choose **Classifier (optional)** and select an authenticated,
classifier-typed model from Pi's registry. Your coding model does not change.
Before any request is sent, approve disclosure for that exact model,
endpoint, and workspace. Escape leaves the previous selection unchanged.

Reviews send bounded metadata: tool name, argument key names, path metadata,
and message-rule text—not argument values or file bodies. Provider retention
terms apply. Classifier results never grant permission or override a block.
Choose **Rules only (no classifier)** to return to local-only checks.

## Verified startup

For stronger startup guarantees, use the bundled launcher instead of `pi`:

```sh
pi-automode          # verify the gate, then start Pi
pi-automode --check  # verify only; no TUI or model requests
```

The launcher verifies gate health before startup and after runtime replacement,
and stops if verification fails. It uses an isolated extension stack rather
than loading your other executable extensions; see [launcher details](docs/launcher.md).
A successful check verifies that the gate loaded, **not** that checks are on.

In ordinary Pi, Automode uses the `tool_call` hook alongside other extensions.
A later hook can still change arguments after review. Use a trusted extension
stack or the verified launcher; neither is a security sandbox.

## Local data

- `<agent-dir>/automode.json`: saved on/off state, rules, classifier selection,
  consent bindings, and limits. Usually `~/.pi/agent/automode.json`.
- `<agent-dir>/automode-logs.json`: bounded newline-delimited JSON decision log.
  It can include exact commands and arguments; treat it as sensitive.
  View or clear it through `/automode logs`.

## Development

```sh
npm run check       # typecheck, build/package checks, offline tests
npm run pack:check  # verify tarball contents
```
