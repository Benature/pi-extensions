import type { Rule } from "../types.js";

/**
 * Scalable matching for allowlist/blocklist command rules.
 *
 * Rule syntax: `*` is the only wildcard and matches any (possibly empty)
 * run of characters, including spaces and newlines; every other byte is
 * literal (whitespace included). A rule without `*` is byte-exact.
 *
 * Lookup is not a linear scan: the lists are compiled once per settings
 * snapshot (memoized by array identity) into an index with
 *   - a hash map of exact rules — O(1) membership, and
 *   - glob patterns precompiled to anchored regexes and bucketed by their
 *     first literal byte — a lookup tests only the bucket matching the
 *     command's first byte plus the leading-`*` bucket.
 * So a lookup is one hash probe plus at most a small bucket of regex tests,
 * independent of total rule count.
 */

export interface CompiledPattern {
  readonly regex: RegExp;
  readonly rule: Rule;
}

export interface RuleIndex {
  /** Rules without `*`, keyed by their exact text. */
  readonly exact: ReadonlyMap<string, Rule>;
  /** Glob patterns bucketed by first literal byte; "" holds leading-`*` rules. */
  readonly patterns: ReadonlyMap<string, readonly CompiledPattern[]>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile a glob rule to an anchored regex; `*` → any run of any characters. */
export function compilePattern(text: string): RegExp {
  const parts = text.split("*").map(escapeRegExp);
  return new RegExp(`^${parts.join("[\\s\\S]*")}$`);
}

/** Bucket key: the pattern's first byte unless it is the `*` wildcard. */
function bucketKey(text: string): string {
  return text.startsWith("*") ? "" : text.slice(0, 1);
}

/** Compile the enabled subset of a rule list into a lookup index. */
export function compileRules(rules: readonly Rule[]): RuleIndex {
  const exact = new Map<string, Rule>();
  const patterns = new Map<string, CompiledPattern[]>();
  for (const rule of rules) {
    if (rule == null || typeof rule.text !== "string" || rule.enabled === false) continue;
    if (!rule.text.includes("*")) {
      if (!exact.has(rule.text)) exact.set(rule.text, rule);
      continue;
    }
    const key = bucketKey(rule.text);
    const bucket = patterns.get(key) ?? [];
    bucket.push({ regex: compilePattern(rule.text), rule });
    patterns.set(key, bucket);
  }
  return { exact, patterns };
}

const indexCache = new WeakMap<readonly Rule[], RuleIndex>();

/** Compiled index for a rule list, memoized by list identity (settings snapshots are frozen). */
export function ruleIndex(rules: readonly Rule[]): RuleIndex {
  let index = indexCache.get(rules);
  if (index === undefined) {
    index = compileRules(rules);
    indexCache.set(rules, index);
  }
  return index;
}

/** First matching enabled rule, or undefined. Exact rules win over patterns. */
export function matchCompiled(index: RuleIndex, command: string): Rule | undefined {
  const exactHit = index.exact.get(command);
  if (exactHit !== undefined) return exactHit;
  const key = command.length > 0 && !command.startsWith("*") ? command.slice(0, 1) : "";
  const own = index.patterns.get(key);
  if (own !== undefined) {
    for (const candidate of own) {
      if (candidate.regex.test(command)) return candidate.rule;
    }
  }
  // Leading-wildcard patterns must be tested against every command.
  if (key !== "") {
    const wild = index.patterns.get("");
    if (wild !== undefined) {
      for (const candidate of wild) {
        if (candidate.regex.test(command)) return candidate.rule;
      }
    }
  }
  return undefined;
}

/** Byte-exact/glob match against the enabled rules of one list. */
export function matchCommandRule(rules: readonly Rule[], command: string): Rule | undefined {
  return matchCompiled(ruleIndex(rules), command);
}
