import { test } from "node:test";
import assert from "node:assert/strict";

import { createCommandHandler, statusText, type CommandCtx, type UiDeps } from "../src/ui.js";
import { DEFAULT_SETTINGS, type AutomodeSettings, type DecisionLog } from "../src/types.js";
import type { AutomodeHealth } from "../src/runtime/health.js";

/**
 * UI tests drive the command handler with scripted dialogs and fake stores.
 * No terminal, no model calls. The central properties: authority changes
 * require a live local TUI plus an explicit confirmed choice; command
 * invocation alone (including forged `/automode off` via sendUserMessage)
 * never authorizes anything; everything displayed is escaped.
 */

function makeSettings(overrides: Partial<AutomodeSettings> = {}) {
	return { ...DEFAULT_SETTINGS, ...overrides, allowlist: [...(overrides.allowlist ?? [])], blocklist: [...(overrides.blocklist ?? [])] };
}

interface ScriptedCtx extends CommandCtx {
	calls: { title: string; options: string[] }[];
	notifications: { message: string; type?: string | undefined }[];
	inputs: { title: string; prefill?: string | undefined }[];
}

interface Harness {
	deps: UiDeps;
	settings: { current: AutomodeSettings; epoch: number; error: string | null; updates: AutomodeSettings[] };
	logs: { entries: DecisionLog[]; cleared: number };
	gate: { state: "off" | "on" | "halted"; haltReason: string | null; pendingManaged: number; operatorUpdates: number; reverified: number };
	health: AutomodeHealth[];
	makeCtx(script: Script, mode?: string, hasUI?: boolean): ScriptedCtx;
}

type Script = Array<string | undefined | ((title: string, options: string[]) => string | undefined)>;

function makeHarness(initial: Partial<AutomodeSettings> = {}, logEntries: DecisionLog[] = []): Harness {
	const health: AutomodeHealth[] = [];
	const settings = {
		current: makeSettings(initial),
		epoch: 1,
		error: null as string | null,
		updates: [] as AutomodeSettings[],
	};
	const logs = { entries: logEntries, cleared: 0 };
	const gate = {
		state: (initial.enabled ? "on" : "off") as "off" | "on" | "halted",
		haltReason: null as string | null,
		pendingManaged: 0,
		operatorUpdates: 0,
		reverified: 0,
	};
	const deps: UiDeps = {
		settings: {
			get current() {
				return settings.current;
			},
			get epoch() {
				return settings.epoch;
			},
			get error() {
				return settings.error;
			},
			async update(next: AutomodeSettings) {
				settings.updates.push(next);
				settings.current = next;
				settings.epoch += 1;
				gate.state = next.enabled ? "on" : "off";
			},
			async reload() {
				return false;
			},
		},
		logs: {
			async read() {
				return logs.entries;
			},
			async clear() {
				logs.entries = [];
				logs.cleared += 1;
			},
		},
		gate: {
			get state() {
				return gate.state;
			},
			get haltReason() {
				return gate.haltReason;
			},
			get pendingManaged() {
				return gate.pendingManaged;
			},
			operatorUpdated() {
				gate.operatorUpdates += 1;
			},
			async reverify() {
				gate.reverified += 1;
				return { ok: true };
			},
		},
		approval: { pendingCount: 0 },
		dirs: { agentDir: "/agent", workspace: "/work", extensionDir: "/ext" },
		host: () => ({}),
		guardedTools: ["read", "edit", "write", "bash"],
		onHealth: (h) => {
			health.push(h);
		},
	};
	const makeCtx = (script: Script, mode = "tui", hasUI = true): ScriptedCtx => {
		const calls: { title: string; options: string[] }[] = [];
		const notifications: { message: string; type?: string | undefined }[] = [];
		const inputs: { title: string; prefill?: string | undefined }[] = [];
		return {
			mode,
			hasUI,
			calls,
			notifications,
			inputs,
			ui: {
				async select(title: string, options: string[]) {
					calls.push({ title, options });
					const entry = script.length > 0 ? script.shift() : undefined;
					return typeof entry === "function" ? entry(title, options) : entry;
				},
				async input(title: string) {
					inputs.push({ title });
					const entry = script.length > 0 ? script.shift() : undefined;
					return typeof entry === "string" ? entry : undefined;
				},
				async editor(title: string, prefill?: string) {
					inputs.push({ title, prefill });
					const entry = script.length > 0 ? script.shift() : undefined;
					return typeof entry === "string" ? entry : undefined;
				},
				notify(message: string, type?: "info" | "warning" | "error") {
					notifications.push({ message, type });
				},
			},
			modelRegistry: {
				async getAvailableOfType() {
					return [
						{ provider: "typesafe", id: "jev-1.13.2", baseUrl: "https://api.typesafe.ai/v1" },
						{ provider: "typesafe", id: "jev-sketchy", baseUrl: "https://key@api.typesafe.ai/v1?token=1" },
					];
				},
			},
		};
	};
	return { deps, settings, logs, gate, health, makeCtx };
}

// ------------------------------------------------------------------ command surface

test("exactly five command forms; anything else is a usage error with no state change", async () => {
	const h = makeHarness({ enabled: false });
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx([], "tui");
	await handler("bogus", ctx);
	await handler("on extra", ctx);
	await handler("ON", ctx);
	assert.equal(h.settings.updates.length, 0);
	assert.equal(ctx.calls.length, 0, "no dialogs opened");
	assert.ok(ctx.notifications.every((n) => n.message.includes("Usage:")));
	assert.equal(ctx.notifications.length, 3);
});

// ------------------------------------------------------------------ toggle authority

test("toggle requires a live local TUI: rpc/json/print are refused even with hasUI", async () => {
	for (const [mode, hasUI] of [
		["rpc", true],
		["json", false],
		["print", false],
	] as const) {
		const h = makeHarness({ enabled: false });
		const handler = createCommandHandler(h.deps);
		const ctx = h.makeCtx(["Turn on"], mode, hasUI);
		await handler("on", ctx);
		assert.equal(h.settings.updates.length, 0, `${mode} must never authorize`);
		assert.equal(ctx.calls.length, 0, "no confirmation dialog outside the local TUI");
		assert.match(ctx.notifications[0]?.message ?? "", /interactive terminal/);
	}
});

test("forged command invocation (e.g. sendUserMessage '/automode off') cannot turn Automode off", async () => {
	const h = makeHarness({ enabled: true });
	const handler = createCommandHandler(h.deps);
	// Simulate a forged dispatch: handler runs in a TUI session with no human at the dialog.
	const ctx = h.makeCtx([undefined]); // Escape/no answer
	await handler("off", ctx);
	assert.equal(h.settings.updates.length, 0);
	assert.equal(h.settings.current.enabled, true);
	// Even if something answers, only the exact explicit label authorizes.
	const ctx2 = h.makeCtx(["Cancel"]);
	await handler("off", ctx2);
	assert.equal(h.settings.updates.length, 0);
	assert.equal(h.gate.operatorUpdates, 0);
});

test("confirmed toggle persists, invalidates held work and reports health", async () => {
	const h = makeHarness({ enabled: false });
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx(["Turn on"]);
	await handler("on", ctx);
	assert.equal(h.settings.updates.length, 1);
	assert.equal(h.settings.current.enabled, true);
	assert.equal(h.gate.operatorUpdates, 1);
	assert.deepEqual(h.health.at(-1), { initialized: true, guardedTools: ["read", "edit", "write", "bash"], enabled: true });

	const ctx2 = h.makeCtx(["Turn off"]);
	await handler("off", ctx2);
	assert.equal(h.settings.current.enabled, false);
	assert.match(ctx2.calls[0]?.title ?? "", /OFF\?/);
	assert.match(ctx2.calls[0]?.title ?? "", /Disable all Automode checks/);
});

test("toggle confirmation defaults to Cancel (first option)", async () => {
	const h = makeHarness({ enabled: false });
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx([undefined]);
	await handler("on", ctx);
	assert.equal(ctx.calls[0]?.options[0], "Cancel");
});

// ------------------------------------------------------------------ rules CRUD

test("add a block message rule verbatim, including whitespace and control chars", async () => {
	const h = makeHarness({ enabled: true });
	const handler = createCommandHandler(h.deps);
	const evilText = "Never deploy to production\n\x1b[31mRED\x1b[0m";
	const ctx = h.makeCtx(["Add rule", "Block message", evilText, "Save rule"]);
	await handler("rules", ctx);
	assert.equal(h.settings.updates.length, 1);
	const rule = h.settings.current.blocklist[0];
	assert.deepEqual(rule, { type: "message", text: evilText }, "saved exactly as written");
	// The confirmation dialog displayed it escaped.
	const confirm = ctx.calls.find((c) => c.title.startsWith("Save rule?"));
	assert.ok(confirm);
	assert.match(confirm?.title ?? "", /\\e\[31m/);
	assert.ok(!(confirm?.title ?? "").includes("\x1b"), "no raw ESC reaches the terminal");
});

test("rule add aborts cleanly on escape at any step", async () => {
	const h = makeHarness({ enabled: true });
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx(["Add rule", undefined]);
	await handler("rules", ctx);
	assert.equal(h.settings.updates.length, 0);
});

test("enable/disable and delete flows; delete requires explicit confirmation", async () => {
	const h = makeHarness({
		enabled: true,
		allowlist: [{ type: "command", text: "npm test -- parser" }],
	});
	const handler = createCommandHandler(h.deps);
	// Disable it (rule lines carry a positional prefix; toggle needs a confirm).
	const ctx = h.makeCtx([
		"1. [allow · command] npm test -- parser",
		"Disable",
		"Disable rule",
	]);
	await handler("rules", ctx);
	assert.equal(h.settings.current.allowlist[0]?.enabled, false);
	// Delete with Cancel → kept.
	const ctx2 = h.makeCtx([
		"1. [allow · command · disabled] npm test -- parser",
		"Delete",
		"Cancel",
	]);
	await handler("rules", ctx2);
	assert.equal(h.settings.current.allowlist.length, 1, "cancelled delete keeps the rule");
	// Delete confirmed → gone.
	const ctx3 = h.makeCtx([
		"1. [allow · command · disabled] npm test -- parser",
		"Delete",
		"Delete rule",
	]);
	await handler("rules", ctx3);
	assert.equal(h.settings.current.allowlist.length, 0);
});

test("rules editor refuses non-TUI modes entirely", async () => {
	const h = makeHarness({ enabled: true });
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx([], "rpc", true);
	await handler("rules", ctx);
	assert.equal(h.settings.updates.length, 0);
	assert.equal(ctx.calls.length, 0);
});

// ------------------------------------------------------------------ classifier picker / disclosure consent

test("picker flow: panel → Review → model → approve stores bindings; consent resets on change", async () => {
	const h = makeHarness({ enabled: true });
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx([
		"Classifier (optional)", // panel menu
		"1. typesafe / jev-1.13.2", // picker
		"Approve disclosure", // consent
		"Close", // back in panel
	]);
	await handler("", ctx);
	const updated = h.settings.current;
	assert.deepEqual(updated.classifier, { provider: "typesafe", model: "jev-1.13.2" });
	assert.equal(updated.disclosureConsent, "approved");
	assert.equal(updated.disclosureProvider, "typesafe", "provider binding recorded on approve");
	assert.equal(updated.disclosureModel, "jev-1.13.2", "model binding recorded on approve");
	assert.equal(updated.disclosureEndpoint, "https://api.typesafe.ai/v1", "origin+pathname binding");
	assert.equal(updated.disclosureWorkspace, "/work", "canonical workspace binding");
});

test("invalid classifier endpoint leaves selection and consent unchanged", async () => {
	const h = makeHarness({ enabled: true });
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx([
		"Classifier (optional)",
		"2. typesafe / jev-sketchy",
		"Close",
	]);
	await handler("", ctx);
	const updated = h.settings.current;
	assert.equal(updated.classifier, null);
	assert.equal(h.settings.updates.length, 0);
	assert.notEqual(updated.disclosureConsent, "approved");
	assert.equal(updated.disclosureProvider, null);
	assert.equal(updated.disclosureModel, null);
	assert.equal(updated.disclosureEndpoint, null);
	assert.equal(updated.disclosureWorkspace, null);
	assert.match(ctx.notifications.at(-1)?.message ?? "", /Selection unchanged/);
});

test("Escape from classifier consent preserves the previous selection and binding", async () => {
	const h = makeHarness({
		enabled: true,
		classifier: { provider: "typesafe", model: "jev-1.13.2" },
		disclosureConsent: "approved",
		disclosureProvider: "typesafe",
		disclosureModel: "jev-1.13.2",
		disclosureEndpoint: "https://api.typesafe.ai/v1",
		disclosureWorkspace: "/work",
	});
	const handler = createCommandHandler(h.deps);
	// Escape the consent dialog after re-picking the same model.
	const ctx = h.makeCtx(["Classifier (optional)", "1. typesafe / jev-1.13.2", undefined, "Close"]);
	await handler("", ctx);
	assert.equal(h.settings.updates.length, 0);
	assert.equal(h.settings.current.disclosureConsent, "approved");
	assert.equal(h.settings.current.disclosureProvider, "typesafe");
	assert.equal(h.settings.current.disclosureModel, "jev-1.13.2");
	assert.equal(h.settings.current.disclosureEndpoint, "https://api.typesafe.ai/v1");
	assert.equal(h.settings.current.disclosureWorkspace, "/work");
});

test("switching to Rules only clears classifier and consent with confirmation", async () => {
	const h = makeHarness({
		enabled: true,
		classifier: { provider: "typesafe", model: "jev-1.13.2" },
		disclosureConsent: "approved",
		disclosureProvider: "typesafe",
		disclosureModel: "jev-1.13.2",
		disclosureEndpoint: "https://api.typesafe.ai/v1",
		disclosureWorkspace: "/work",
	});
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx(["Classifier (optional)", "Rules only (no classifier)", "Switch to Rules", "Close"]);
	await handler("", ctx);
	assert.equal(h.settings.current.classifier, null);
	assert.equal(h.settings.current.disclosureConsent, "none");
	assert.equal(h.settings.current.disclosureProvider, null);
	assert.equal(h.settings.current.disclosureModel, null);
	assert.equal(h.settings.current.disclosureEndpoint, null);
});

// ------------------------------------------------------------------ logs viewer

const SAMPLE_LOG: DecisionLog = {
	id: "l1",
	time: "2026-10-12T01:02:03.000Z",
	action: { requestId: "r1", tool: "bash", args: { command: "git push \x1b[7m--force" }, cwd: "/work" },
	outcome: "block",
	source: "rule:blocklist \x1b[7m",
	reason: "exact blocklist command rule match",
	matchedRule: { type: "command", text: "git push --force" },
};

test("logs viewer shows decisions escaped and detail honestly reports uncaptured fields", async () => {
	const h = makeHarness({ enabled: true }, [SAMPLE_LOG]);
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx([
		(_title, options) => {
			assert.ok(options.every((o) => !o.includes("\x1b")), "no raw ESC reaches the terminal");
			return `1. ${SAMPLE_LOG.time} BLOCK · rule:blocklist \\e[7m — $ git push \\e[7m--force`;
		},
		"Close", // detail dialog
		"Close", // back to list → close
	]);
	await handler("logs", ctx);
	const detail = ctx.calls[1];
	assert.match(detail?.title ?? "", /classifier: not captured/);
	assert.match(detail?.title ?? "", /input: not captured/);
	assert.ok(!(detail?.title ?? "").includes("\x1b"));
});

test("clearing logs requires local TUI confirmation; rpc can view but not clear", async () => {
	const h = makeHarness({ enabled: true }, [SAMPLE_LOG]);
	const handler = createCommandHandler(h.deps);
	// rpc: view allowed, clear refused.
	const rpcCtx = h.makeCtx(["Clear logs"], "rpc", true);
	await handler("logs", rpcCtx);
	assert.equal(h.logs.cleared, 0);
	assert.equal(h.logs.entries.length, 1);
	// tui confirmed clear.
	const tuiCtx = h.makeCtx(["Clear logs", "Clear logs", "Close"]);
	await handler("logs", tuiCtx);
	assert.equal(h.logs.cleared, 1);
	assert.equal(h.logs.entries.length, 0);
});

// ------------------------------------------------------------------ status

test("status line reflects off/on/halted honestly", () => {
	const off = makeHarness({ enabled: false });
	assert.match(statusText(off.deps), /automode · off$/);
	const on = makeHarness({ enabled: true });
	assert.match(statusText(on.deps), /automode · on$/);
	const halted = makeHarness({ enabled: true });
	halted.gate.state = "halted";
	halted.gate.haltReason = "drift";
	assert.match(statusText(halted.deps), /halted/);
});

test("panel is compact and action labels have no trailing dots", async () => {
	const h = makeHarness();
	const ctx = h.makeCtx(["Close"]);
	await createCommandHandler(h.deps)("", ctx);
	assert.deepEqual(ctx.calls[0]?.options, ["Turn on", "Rules", "Logs", "Classifier (optional)", "Details", "Close"]);
	assert.ok((ctx.calls[0]?.title.split("\n").length ?? 100) <= 4);
	assert.ok(ctx.calls[0]?.options.every((label) => !/[.…]$/.test(label)));
});

test("empty rules and logs have no selectable placeholder rows", async () => {
	const h = makeHarness();
	const rules = h.makeCtx(["Done"]);
	await createCommandHandler(h.deps)("rules", rules);
	assert.deepEqual(rules.calls[0]?.options, ["Add rule", "Done"]);
	const logs = h.makeCtx(["Close"]);
	await createCommandHandler(h.deps)("logs", logs);
	assert.deepEqual(logs.calls[0]?.options, ["Close"]);
});

test("duplicate log summaries open their own record instead of the last matching label", async () => {
	const h = makeHarness({}, [{ ...SAMPLE_LOG, id: "older" }, { ...SAMPLE_LOG, id: "newer" }]);
	const ctx = h.makeCtx([(_title, options) => options[0], "Close", "Close"]);
	await createCommandHandler(h.deps)("logs", ctx);
	assert.notEqual(ctx.calls[0]?.options[0], ctx.calls[0]?.options[1]);
	assert.match(ctx.calls[1]?.title ?? "", /id: newer/);
});

test("declining classifier disclosure explicitly saves a local-only selection", async () => {
	const h = makeHarness();
	const ctx = h.makeCtx(["Classifier (optional)", "1. typesafe / jev-1.13.2", "Decline disclosure", "Close"]);
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.current.disclosureConsent, "declined");
	assert.equal(h.settings.current.disclosureEndpoint, null);
});

test("classifier labels stay distinct after truncation and disclosure text is escaped", async () => {
	const h = makeHarness();
	const prefix = "x".repeat(240);
	const ctx = h.makeCtx(["Classifier (optional)", (_title, options) => {
		assert.notEqual(options[1], options[2]);
		return options[2];
	}, "Approve disclosure", "Close"]);
	ctx.modelRegistry = { async getAvailableOfType() {
		return [
			{ provider: "test", id: `${prefix}a`, baseUrl: "https://example.com" },
			{ provider: "test", id: `${prefix}b\x1b[31m`, baseUrl: "https://example.com" },
		];
	} };
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.current.classifier?.model, `${prefix}b\x1b[31m`);
	assert.ok(ctx.calls.every((call) => !call.title.includes("\x1b") && call.options.every((option) => !option.includes("\x1b"))));
});

test("halt reason is escaped and recovery is the first action", async () => {
	const h = makeHarness({ enabled: true });
	h.gate.state = "halted";
	h.gate.haltReason = "bad\x1b[31mconfig";
	const ctx = h.makeCtx(["Close"]);
	await createCommandHandler(h.deps)("", ctx);
	assert.ok(!ctx.calls[0]?.title.includes("\x1b"));
	assert.equal(ctx.calls[0]?.options[0], "Re-verify configuration");
});

// ------------------------------------------------------------------ epoch binding / queue visibility

test("a stale confirmation (settings epoch moved mid-dialog) is discarded, not applied", async () => {
	const h = makeHarness({ enabled: false });
	const handler = createCommandHandler(h.deps);
	// The dialog answers "Turn on", but the settings epoch moved while the
	// dialog was open: the confirmation was shown for state S and must never
	// apply to a newer state.
	const ctx = h.makeCtx([
		() => {
			h.settings.epoch += 1;
			return "Turn on";
		},
	]);
	await handler("on", ctx);
	assert.equal(h.settings.updates.length, 0, "stale confirmation must not commit");
	assert.equal(h.settings.current.enabled, false);
	assert.match(ctx.notifications.at(-1)?.message ?? "", /changed while you were deciding/);
	assert.equal(h.gate.operatorUpdates, 0);
});

test("managed queue diagnostics live in Details, not the footer or main panel", async () => {
	const h = makeHarness({ enabled: true });
	h.gate.pendingManaged = 3;
	assert.equal(statusText(h.deps), "automode · on");
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx(["Details", "Back", "Close"]);
	await handler("", ctx);
	assert.doesNotMatch(ctx.calls[0]?.title ?? "", /managed|Settings|Coverage/);
	assert.match(ctx.calls[1]?.title ?? "", /Pending: 3 managed, 0 awaiting approval/);
});
