# Changelog

## Unreleased

- Simplify the panel and footer, move diagnostics into Details, remove trailing
  ellipses, and combine rule type/effect into one step. Empty lists no longer
  contain selectable placeholder rows.
- Keep classifier selection unchanged when consent is cancelled or the endpoint
  is invalid. Distinguish duplicate log summaries so each opens its own record.
- Escape halt reasons, classifier disclosure fields, and approval reasons before
  terminal display. Keep internal decision sources in approval details.
- Match Pi's PATH ordering when its agent-bin directory is already present,
  including lexical agent-directory aliases; an earlier untrusted executable
  can no longer be mistaken for a trusted system binary.
- Resolve dangling symlink destinations before classifying protected writes.
- Reject oversized settings updates before replacing the readable configuration.
- Rewrite the README around setup, everyday use, and the beta's actual limits.

- Review `read`, `edit`, `write`, and `bash` through Pi's `tool_call` hook
  instead of registering replacement tool definitions. The gate no longer
  conflicts with extensions that customize those tools, and the verified
  launcher checks the hook instead of tool registration.

## 0.1.0

- First public beta of the parent-session permission gate: `/automode` panel,
  on/off, plain-text rules, bounded local decision logs, and the verified SDK
  launcher.
- Deterministic policy: workspace file floor, protected paths, byte-exact
  command rules, unresolved message blocks, and fail-closed coverage for
  unsupported tool routes.
- Native classifier shadow review with consent binding, bounded disclosure,
  deadlines, budgets, and breaker accounting. Shadow receipts never authorize
  an action.
