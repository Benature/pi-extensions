import type { Rule } from "./types.js";

/**
 * Built-in default rules, always active while Automode is on. This separate
 * file is the operator-readable source of truth; defaults cannot be edited,
 * disabled, or moved from the rules editor, and operator rules can only add
 * to them — every blocklist (default or operator) outranks every allowlist.
 *
 * Rule syntax: `*` matches any run of characters; every other byte is
 * literal. Matching is indexed (see core/rules.ts), so defaults cost one
 * hash probe per decision.
 *
 * Default allowlist entries only ever skip approval for narrowly verified
 * read-only shell invocations with complete evidence; an opaque or
 * unverifiable match still asks (see policy.ts and core/shell.ts).
 */

/** Read-only inspection commands; evidence verification still applies. */
export const DEFAULT_ALLOWLIST: readonly Rule[] = Object.freeze([
	"ls",
	"ls *",
	"cat *",
	"head *",
	"tail *",
	"wc *",
	"file *",
	"pwd",
	"echo *",
	"printf *",
	"whoami",
	"hostname",
	"uname",
	"uname *",
	"basename *",
	"dirname *",
	"true",
	"false",
].map((text) => Object.freeze({ text }) as Rule));

/** Catastrophic-by-default commands: disk wipes, device overwrites, fork bombs. */
export const DEFAULT_BLOCKLIST: readonly Rule[] = Object.freeze([
	"rm -rf /",
	"rm -rf /*",
	"rm -rf ~",
	"rm -rf ~/*",
	"rm -rf $HOME",
	"rm -rf $HOME/*",
	"rm -fr /",
	"rm -fr /*",
	"rm -fr ~",
	"rm -fr ~/*",
	"sudo rm -rf *",
	"sudo rm -fr *",
	"mkfs",
	"mkfs *",
	"mkfs.*",
	"dd *of=/dev/*",
	"* > /dev/sd*",
	"* >/dev/sd*",
	"* > /dev/nvme*",
	"* >/dev/nvme*",
	"chmod -R 777 /",
	"chmod -R 777 /*",
	":(){ :|:& };:",
].map((text) => Object.freeze({ text }) as Rule));
