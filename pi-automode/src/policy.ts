import { isWithinOrEqual } from "./core/paths.js";
import { matchCommandRule } from "./core/rules.js";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "./default-rules.js";
import type { ActionEvidence, AutomodeSettings, Decision, Rule } from "./types.js";

/**
 * Pure policy: deterministic precedence over canonical evidence.
 *
 * Precedence (a configured decision model may settle an Ask later; a Block
 * is always final):
 *   supported route/integrity → protected writes → blocklist command rules
 *   (operator, then built-in defaults) → workspace file floor and narrowly
 *   supported allowlist shell rules (operator, then defaults) → Ask.
 *
 * Command rules are strict commands or glob patterns matched against the
 * full command text (`*` matches any run of characters; every other byte is
 * literal). Opaque shell (composition, interpreters, git, unverifiable
 * executables, PATH or startup-env ambiguity) Asks even with a matching
 * allowlist rule.
 */

export const SUPPORTED_TOOLS: ReadonlySet<string> = new Set(["read", "edit", "write", "bash"]);

function block(source: string, reason: string, matchedRule?: Rule): Decision {
  const d: Decision = { outcome: "block", source, reason };
  if (matchedRule !== undefined) d.matchedRule = matchedRule;
  return d;
}

function ask(source: string, reason: string): Decision {
  return { outcome: "ask", source, reason };
}

function allow(source: string, reason: string, matchedRule?: Rule): Decision {
  const d: Decision = { outcome: "allow", source, reason };
  if (matchedRule !== undefined) d.matchedRule = matchedRule;
  return d;
}

export { matchCommandRule };

export function evaluatePolicy(evidence: ActionEvidence, settings: AutomodeSettings): Decision {
  const tool = evidence.action.tool;

  // 1. Supported route / integrity. Unknown/custom/nested routes Block;
  //    one-shot approval cannot lift missing coverage.
  if (!SUPPORTED_TOOLS.has(tool)) {
    return block(
      "policy:unsupported-route",
      `tool '${tool}' has no verified execution route in this beta`,
    );
  }

  const isWrite = tool === "edit" || tool === "write";

  // 2. Protected writes are final Blocks; nothing later revives them.
  if (isWrite && evidence.protectedReason !== undefined) {
    return block(
      "policy:protected-write",
      `writes to protected target (${evidence.protectedReason}) are blocked while Automode is On`,
    );
  }

  // 3. Blocklist command rules (enabled operator rules, then built-in
  //    defaults). Works even when shell evidence is incomplete: the match
  //    itself needs no filesystem proof.
  if (tool === "bash") {
    const command = evidence.action.args?.command;
    if (typeof command === "string") {
      const blockRule = matchCommandRule(settings.blocklist, command);
      if (blockRule !== undefined) {
        return block("rule:blocklist", "blocklist rule match", blockRule);
      }
      const defaultBlock = matchCommandRule(DEFAULT_BLOCKLIST, command);
      if (defaultBlock !== undefined) {
        return block("rule:default-blocklist", "built-in default blocklist rule match", defaultBlock);
      }
    }
  }

  // 4a. Workspace file floor: native reads/edits/writes canonically inside the
  //     workspace, not protected, with complete evidence.
  if (tool === "read" || isWrite) {
    if (evidence.sensitive || evidence.protectedReason !== undefined) {
      // Protected/sensitive reads are a local Ask, never decision-model review.
      return ask(
        "policy:sensitive-read",
        `target is protected (${evidence.protectedReason ?? "secret-bearing"}); requires a local operator decision`,
      );
    }
    if (!evidence.complete) {
      return ask(
        "policy:incomplete-evidence",
        `filesystem evidence is incomplete (${evidence.reason ?? "unknown cause"}); unprovable cases ask`,
      );
    }
    if (
      evidence.canonicalPath !== undefined
      && isWithinOrEqual(evidence.workspace, evidence.canonicalPath)
    ) {
      return allow(
        "policy:workspace-floor",
        `native ${tool} on a canonical non-protected path inside the workspace`,
      );
    }
    return ask(
      "policy:outside-workspace",
      "canonical target is outside the workspace; the deterministic floor does not cover it",
    );
  }

  // 4b. Narrowly supported allowlist shell rules. A matching allowlist rule
  //     alone is not proof of effects: approved Bash internals are not
  //     sandboxed, so opaque commands Ask even when the text matches.
  const command = evidence.action.args?.command;
  if (typeof command === "string") {
    const operatorAllow = matchCommandRule(settings.allowlist, command);
    const defaultAllow = operatorAllow === undefined ? matchCommandRule(DEFAULT_ALLOWLIST, command) : undefined;
    const allowRule = operatorAllow ?? defaultAllow;
    if (allowRule !== undefined) {
      if (!evidence.complete) {
        return ask(
          "policy:opaque-shell",
          `allowlist rule matched but shell evidence is incomplete (${evidence.reason ?? "unknown cause"}); unverifiable commands are not auto-allowed`,
        );
      }
      return allow(
        defaultAllow !== undefined ? "rule:default-allowlist" : "rule:allowlist",
        `${defaultAllow !== undefined ? "built-in default allowlist" : "allowlist"} rule match with complete evidence`,
        allowRule,
      );
    }
  }
  return ask(
    "policy:no-matching-rule",
    "no allowlist or blocklist rule covers this invocation",
  );
}
