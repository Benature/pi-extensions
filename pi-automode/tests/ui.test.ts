import { test } from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { createCommandHandler, refreshStatus, statusText, type CommandCtx, type UiDeps } from "../src/ui.js";
import { DEFAULT_SETTINGS, type AutomodeSettings, type DecisionLog } from "../src/types.js";
import type { AutomodeHealth } from "../src/runtime/health.js";

/**
 * UI tests drive the command handler with scripted dialogs and fake stores.
 * No terminal, no model calls. The central properties: authority changes
 * require a live local TUI; the toggle and the classifier picker are
 * single-step (the invocation or selected option is the decision), while
 * rule edits and log clearing still require an explicit confirmation;
 * non-TUI modes never authorize anything; everything displayed is escaped.
 */

function makeSettings(overrides: Partial<AutomodeSettings> = {}) {
	return { ...DEFAULT_SETTINGS, ...overrides, allowlist: [...(overrides.allowlist ?? [])], blocklist: [...(overrides.blocklist ?? [])] };
}

/** Theme stub emitting real ANSI so painted labels can be stripped like Pi's. */
const THEME_CODES: Record<string, number> = { success: 32, warning: 33, error: 31, accent: 36, muted: 90 };
const STUB_THEME = {
	fg(color: string, text: string) {
		return `\x1b[${THEME_CODES[color] ?? 39}m${text}\x1b[0m`;
	},
} as unknown as Theme;

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

interface ScriptedCtx extends CommandCtx {
	calls: { title: string; options: string[] }[];
	notifications: { message: string; type?: string | undefined }[];
	inputs: { title: string; prefill?: string | undefined }[];
	statuses: (string | undefined)[];
}

interface Harness {
	deps: UiDeps;
	settings: { current: AutomodeSettings; epoch: number; error: string | null; updates: AutomodeSettings[] };
	logs: { entries: DecisionLog[]; cleared: number };
	gate: { state: "off" | "on" | "halted"; haltReason: string | null; pendingManaged: number; operatorUpdates: number; reverified: number };
	health: AutomodeHealth[];
	makeCtx(script: Script, mode?: string, hasUI?: boolean, theme?: Theme): ScriptedCtx;
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
	const makeCtx = (script: Script, mode = "tui", hasUI = true, theme?: Theme): ScriptedCtx => {
		const calls: { title: string; options: string[] }[] = [];
		const notifications: { message: string; type?: string | undefined }[] = [];
		const inputs: { title: string; prefill?: string | undefined }[] = [];
		const statuses: (string | undefined)[] = [];
		return {
			mode,
			hasUI,
			calls,
			notifications,
			inputs,
			statuses,
			ui: {
				...(theme !== undefined ? { theme } : {}),
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
				setStatus(_key: string, text: string | undefined) {
					statuses.push(text);
				},
			},
			modelRegistry: {
				getModelsOfType() {
					return [
						{ provider: "typesafe", id: "jev-1.13.2", baseUrl: "https://api.typesafe.ai/v1" },
						{ provider: "typesafe", id: "jev-sketchy", baseUrl: "https://key@api.typesafe.ai/v1?token=1" },
					];
				},
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

// ------------------------------------------------------------------ toggle

test("toggle requires a live local TUI: rpc/json/print are refused even with hasUI", async () => {
	for (const [mode, hasUI] of [
		["rpc", true],
		["json", false],
		["print", false],
	] as const) {
		const h = makeHarness({ enabled: false });
		const handler = createCommandHandler(h.deps);
		const ctx = h.makeCtx([], mode, hasUI);
		await handler("on", ctx);
		assert.equal(h.settings.updates.length, 0, `${mode} must never authorize`);
		assert.equal(ctx.calls.length, 0, "no dialog outside the local TUI");
		assert.match(ctx.notifications[0]?.message ?? "", /interactive terminal/);
	}
});

test("a toggle saves in one step with zero select dialogs and reports health", async () => {
	const h = makeHarness({ enabled: false });
	const handler = createCommandHandler(h.deps);

	const on = h.makeCtx([], "tui", true, STUB_THEME);
	await handler("on", on);
	assert.equal(on.calls.length, 0, "no confirmation dialog");
	assert.equal(h.settings.updates.length, 1);
	assert.equal(h.settings.current.enabled, true);
	assert.equal(h.gate.operatorUpdates, 1);
	assert.deepEqual(h.health.at(-1), { initialized: true, guardedTools: ["read", "edit", "write", "bash"], enabled: true });
	assert.equal(on.notifications.at(-1)?.message, "Automode is on.");
	assert.equal(on.statuses.at(-1), "\x1b[32mAutomode: On\x1b[0m", "refreshStatus paints with ctx.ui.theme");

	// Already on: notify, do not save or redisplay.
	const already = h.makeCtx([], "tui", true, STUB_THEME);
	await handler("on", already);
	assert.equal(already.calls.length, 0);
	assert.equal(h.settings.updates.length, 1);
	assert.equal(already.notifications.at(-1)?.message, "Already on.");

	const off = h.makeCtx([], "tui", true, STUB_THEME);
	await handler("off", off);
	assert.equal(off.calls.length, 0);
	assert.equal(h.settings.current.enabled, false);
	assert.equal(h.gate.operatorUpdates, 2);
	assert.equal(off.notifications.at(-1)?.message, "Automode is off.");
	assert.equal(off.statuses.at(-1), "\x1b[33mAutomode: Off\x1b[0m");

	const alreadyOff = h.makeCtx([]);
	await handler("off", alreadyOff);
	assert.equal(h.settings.updates.length, 2);
	assert.equal(alreadyOff.notifications.at(-1)?.message, "Already off.");
});

test("a halted gate accepts a toggle even when the enabled flag already matches", async () => {
	const h = makeHarness({ enabled: true });
	h.gate.state = "halted";
	h.gate.haltReason = "drift";
	const ctx = h.makeCtx([]);
	await createCommandHandler(h.deps)("on", ctx);
	assert.equal(h.settings.updates.length, 1, "halt recovery is a real state change");
	assert.equal(h.gate.operatorUpdates, 1);
	assert.equal(ctx.notifications.at(-1)?.message, "Automode is on.");
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

// ------------------------------------------------------------------ classifier picker

test("picker header discloses the bounded metadata and never asks for consent", async () => {
	const h = makeHarness({ enabled: true });
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			assert.equal(options[0], "Rules only (no classifier)");
			return undefined; // Escape.
		},
		"Close",
	]);
	await createCommandHandler(h.deps)("", ctx);
	const title = ctx.calls[1]?.title ?? "";
	assert.equal(title.split("\n")[0], "Classifier — shadow review");
	assert.equal(title.split("\n").length, 4, "compact disclosure plus each model's destination");
	assert.match(title, /bounded metadata/);
	assert.match(title, /never argument values or file bodies/);
	assert.match(title, /never approve actions/);
});

test("picker shows unavailable classifiers with login required and pins the current selection first", async () => {
	const h = makeHarness({
		enabled: true,
		classifier: { provider: "typesafe", model: "jev-old" },
		disclosureConsent: "approved",
		disclosureProvider: "typesafe",
		disclosureModel: "jev-old",
		disclosureEndpoint: "https://api.typesafe.ai/v1",
		disclosureWorkspace: "/work",
	});
	let picker: string[] = [];
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			picker = options;
			return undefined; // Escape cancels.
		},
		"Close",
	], "tui", true, STUB_THEME);
	ctx.modelRegistry = {
		getModelsOfType() {
			return [
				{ provider: "typesafe", id: "jev-1.13.2", baseUrl: "https://api.typesafe.ai/v1" },
				{ provider: "typesafe", id: "jev-sketchy", baseUrl: "https://api.typesafe.ai/v1" },
				{ provider: "typesafe", id: "jev-old", baseUrl: "https://api.typesafe.ai/v1" },
			];
		},
		async getAvailableOfType() {
			return [{ provider: "typesafe", id: "jev-1.13.2", baseUrl: "https://api.typesafe.ai/v1" }];
		},
	};
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(stripAnsi(picker[0] ?? ""), "Rules only (no classifier)");
	assert.equal(stripAnsi(picker[1] ?? ""), "[current] typesafe/jev-old · login required");
	assert.equal(stripAnsi(picker[2] ?? ""), "typesafe/jev-1.13.2");
	assert.equal(stripAnsi(picker[3] ?? ""), "typesafe/jev-sketchy · login required");
	assert.match(picker[1] ?? "", /\x1b\[36m\[current\]\x1b\[0m/, "current prefix is accent");
	assert.match(picker[1] ?? "", /\x1b\[33mlogin required\x1b\[0m/, "missing login is warning");
	assert.equal(h.settings.updates.length, 0, "Escape cancels");
});

test("a failed availability lookup marks classifiers untested, not missing", async () => {
	const h = makeHarness({ enabled: true });
	let picker: string[] = [];
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			picker = options;
			return undefined;
		},
		"Close",
	], "tui", true, STUB_THEME);
	ctx.modelRegistry = {
		getModelsOfType() {
			return [{ provider: "typesafe", id: "jev-1.13.2", baseUrl: "https://api.typesafe.ai/v1" }];
		},
		async getAvailableOfType() {
			throw new Error("aborted");
		},
	};
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(stripAnsi(picker[1] ?? ""), "typesafe/jev-1.13.2 · untested");
	assert.match(picker[1] ?? "", /\x1b\[90muntested\x1b\[0m/, "unknown availability is muted");
});

test("picker falls back to availability results when getModelsOfType is unavailable", async () => {
	const h = makeHarness({ enabled: true });
	let picker: string[] = [];
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			picker = options;
			return undefined;
		},
		"Close",
	]);
	ctx.modelRegistry = {
		async getAvailableOfType() {
			return [{ provider: "typesafe", id: "jev-1.13.2", baseUrl: "https://api.typesafe.ai/v1" }];
		},
	};
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(stripAnsi(picker[1] ?? ""), "typesafe/jev-1.13.2", "available entries become the catalogue");
	assert.equal(h.settings.updates.length, 0);
});

test("picking a classifier saves it with consent and all four bindings, no consent dialog", async () => {
	const h = makeHarness({ enabled: true });
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => options.find((option) => stripAnsi(option) === "typesafe/jev-1.13.2"),
		"Close",
	]);
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.updates.length, 1);
	const updated = h.settings.current;
	assert.deepEqual(updated.classifier, { provider: "typesafe", model: "jev-1.13.2" });
	assert.equal(updated.disclosureConsent, "approved", "selecting the model is the consent");
	assert.equal(updated.disclosureProvider, "typesafe");
	assert.equal(updated.disclosureModel, "jev-1.13.2");
	assert.equal(updated.disclosureEndpoint, "https://api.typesafe.ai/v1");
	assert.equal(updated.disclosureWorkspace, "/work");
	assert.equal(ctx.notifications.at(-1)?.message, "Shadow review: typesafe/jev-1.13.2.");
	assert.ok(ctx.calls.every((call) => !/consent/i.test(call.title)), "no separate consent dialog");
});

test("invalid classifier endpoint changes nothing", async () => {
	const h = makeHarness({ enabled: true });
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => options.find((option) => stripAnsi(option) === "typesafe/jev-sketchy"),
		"Close",
	]);
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.updates.length, 0);
	assert.equal(h.settings.current.classifier, null);
	assert.equal(h.settings.current.disclosureConsent, "none");
	assert.equal(h.settings.current.disclosureProvider, null);
	assert.equal(h.settings.current.disclosureModel, null);
	assert.equal(h.settings.current.disclosureEndpoint, null);
	assert.equal(h.settings.current.disclosureWorkspace, null);
	assert.equal(ctx.notifications.at(-1)?.type, "warning");
	assert.match(ctx.notifications.at(-1)?.message ?? "", /Selection unchanged/);
});

test("Escape from the picker preserves the previous selection and binding", async () => {
	const h = makeHarness({
		enabled: true,
		classifier: { provider: "typesafe", model: "jev-1.13.2" },
		disclosureConsent: "approved",
		disclosureProvider: "typesafe",
		disclosureModel: "jev-1.13.2",
		disclosureEndpoint: "https://api.typesafe.ai/v1",
		disclosureWorkspace: "/work",
	});
	const ctx = h.makeCtx(["Decision Models", undefined, "Close"]);
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.updates.length, 0);
	assert.equal(h.settings.current.disclosureConsent, "approved");
	assert.equal(h.settings.current.disclosureProvider, "typesafe");
	assert.equal(h.settings.current.disclosureModel, "jev-1.13.2");
	assert.equal(h.settings.current.disclosureEndpoint, "https://api.typesafe.ai/v1");
	assert.equal(h.settings.current.disclosureWorkspace, "/work");
});

test("Rules only clears classifier and consent in one step", async () => {
	const h = makeHarness({
		enabled: true,
		classifier: { provider: "typesafe", model: "jev-1.13.2" },
		disclosureConsent: "approved",
		disclosureProvider: "typesafe",
		disclosureModel: "jev-1.13.2",
		disclosureEndpoint: "https://api.typesafe.ai/v1",
		disclosureWorkspace: "/work",
	});
	const ctx = h.makeCtx(["Decision Models", "Rules only (no classifier)", "Close"]);
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.updates.length, 1);
	assert.equal(ctx.calls.length, 3, "panel, picker, panel — no confirmation dialog");
	assert.equal(h.settings.current.classifier, null);
	assert.equal(h.settings.current.disclosureConsent, "none");
	assert.equal(h.settings.current.disclosureProvider, null);
	assert.equal(h.settings.current.disclosureModel, null);
	assert.equal(h.settings.current.disclosureEndpoint, null);
	assert.equal(h.settings.current.disclosureWorkspace, null);
	assert.match(ctx.notifications.at(-1)?.message ?? "", /Rules only/);
});

test("a classifier choice made in a stale epoch is discarded, not applied", async () => {
	const h = makeHarness({ enabled: true });
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			h.settings.epoch += 1;
			return options.find((option) => stripAnsi(option) === "typesafe/jev-1.13.2");
		},
		"Close",
	]);
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.updates.length, 0, "stale choice must not commit");
	assert.equal(h.settings.current.classifier, null);
	assert.match(ctx.notifications.at(-1)?.message ?? "", /changed while you were deciding/);
});

test("escaped-pin collisions still map a row to its own model", async () => {
	const h = makeHarness({ enabled: true });
	const models = [
		{ provider: "test", id: "x\u001b", baseUrl: "https://example.com" },
		{ provider: "test", id: "x\\e", baseUrl: "https://example.com" },
	];
	let labels: string[] = [];
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			labels = options.map(stripAnsi);
			return options[2]; // the second model row
		},
		"Close",
	]);
	ctx.modelRegistry = {
		getModelsOfType() {
			return models;
		},
		async getAvailableOfType() {
			return models;
		},
	};
	await createCommandHandler(h.deps)("", ctx);
	assert.deepEqual(labels.slice(1), ["test/x\\e", "test/x\\e (2)"]);
	assert.equal(h.settings.current.classifier?.model, "x\\e", "row 2 must save its own model");
});

test("suffix collisions never fall back to a different classifier", async () => {
	const h = makeHarness({ enabled: true });
	const registered = [
		{ provider: "test", id: "jev", baseUrl: "https://example.com" },
		{ provider: "test", id: "jev · login required", baseUrl: "https://example.com" },
	];
	let labels: string[] = [];
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			labels = options.map(stripAnsi);
			return options[2]; // the unavailable row, whose suffix repeats the marker
		},
		"Close",
	]);
	ctx.modelRegistry = {
		getModelsOfType() {
			return registered;
		},
		async getAvailableOfType() {
			return [{ provider: "test", id: "jev", baseUrl: "https://example.com" }];
		},
	};
	await createCommandHandler(h.deps)("", ctx);
	assert.deepEqual(labels.slice(1), ["test/jev", "test/jev · login required · login required"]);
	assert.equal(h.settings.current.classifier?.model, "jev · login required");
});

test("classifier labels stay distinct and never emit raw control bytes", async () => {
	const h = makeHarness({ enabled: true });
	const prefix = "x".repeat(240);
	const ctx = h.makeCtx([
		"Decision Models",
		(_title, options) => {
			assert.notEqual(options[1], options[2]);
			return options[2];
		},
		"Close",
	]);
	ctx.modelRegistry = {
		getModelsOfType() {
			return [
				{ provider: "test", id: `${prefix}a`, baseUrl: "https://example.com" },
				{ provider: "test", id: `${prefix}b\x1b[31m`, baseUrl: "https://example.com" },
			];
		},
		async getAvailableOfType() {
			return [
				{ provider: "test", id: `${prefix}a`, baseUrl: "https://example.com" },
				{ provider: "test", id: `${prefix}b\x1b[31m`, baseUrl: "https://example.com" },
			];
		},
	};
	await createCommandHandler(h.deps)("", ctx);
	assert.equal(h.settings.current.classifier?.model, `${prefix}b\x1b[31m`);
	assert.ok(ctx.calls.every((call) => !call.title.includes("\x1b") && call.options.every((option) => !option.includes("\x1b"))));
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

// ------------------------------------------------------------------ status / panel

test("RPC status and panel stay plain even when a theme is provided", async () => {
	const h = makeHarness({ enabled: true });
	const rpc = h.makeCtx([], "rpc", true, STUB_THEME);
	refreshStatus(h.deps, rpc);
	assert.equal(rpc.statuses.at(-1), "Automode: On");
	assert.ok(!(rpc.statuses.at(-1) ?? "").includes("\x1b"), "no ANSI over the RPC protocol");
	const tui = h.makeCtx([], "tui", true, STUB_THEME);
	refreshStatus(h.deps, tui);
	assert.match(tui.statuses.at(-1) ?? "", /\x1b\[32mAutomode: On/);
	const panel = h.makeCtx(["Close"], "rpc", true, STUB_THEME);
	await createCommandHandler(h.deps)("", panel);
	assert.ok(!(panel.calls[0]?.title ?? "").includes("\x1b"), "panel header paints only in the TUI");
});

test("status text paints On green, Off yellow and Halted red with a theme", () => {
	const off = makeHarness({ enabled: false });
	assert.equal(statusText(off.deps), "Automode: Off", "plain without a theme");
	assert.equal(statusText(off.deps, STUB_THEME), "\x1b[33mAutomode: Off\x1b[0m");

	const on = makeHarness({ enabled: true });
	assert.equal(statusText(on.deps), "Automode: On");
	assert.equal(statusText(on.deps, STUB_THEME), "\x1b[32mAutomode: On\x1b[0m");

	const halted = makeHarness({ enabled: true });
	halted.gate.state = "halted";
	halted.gate.haltReason = "drift";
	assert.equal(statusText(halted.deps), "Automode: Halted");
	assert.equal(statusText(halted.deps, STUB_THEME), "\x1b[31mAutomode: Halted\x1b[0m");
});

test("panel header is the status label alone, with no state subtitle", async () => {
	const h = makeHarness();
	const ctx = h.makeCtx(["Close"], "tui", true, STUB_THEME);
	await createCommandHandler(h.deps)("", ctx);
	assert.deepEqual(ctx.calls[0]?.options, ["Toggle ON", "Rules", "Logs", "Decision Models", "Details", "Close"]);
	const title = ctx.calls[0]?.title ?? "";
	assert.equal(title, "\x1b[33mAutomode: Off\x1b[0m", "label only; no subtitle");
	assert.ok(!/Guarded tools are checked|run without Automode checks/.test(title));
	assert.ok(ctx.calls[0]?.options.every((label) => !/[.…]$/.test(label)));
});

test("the toggle option names the action and mirrors the live state", async () => {
	for (const enabled of [true, false]) {
		const h = makeHarness({ enabled });
		const ctx = h.makeCtx(["Close"]);
		await createCommandHandler(h.deps)("", ctx);
		assert.equal(ctx.calls[0]?.options[0], enabled ? "Toggle OFF" : "Toggle ON");
	}
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

test("halt reason is escaped and recovery is the first action", async () => {
	const h = makeHarness({ enabled: true });
	h.gate.state = "halted";
	h.gate.haltReason = "bad\x1b[31mconfig";
	const ctx = h.makeCtx(["Close"]);
	await createCommandHandler(h.deps)("", ctx);
	const title = ctx.calls[0]?.title ?? "";
	assert.ok(!title.includes("\x1b"));
	assert.match(title, /^Automode: Halted\n/);
	assert.match(title, /Halted: bad\\e\[31mconfig/);
	assert.equal(ctx.calls[0]?.options[0], "Re-verify configuration");
});

// ------------------------------------------------------------------ epoch binding / queue visibility

test("a stale rule confirmation (settings epoch moved mid-dialog) is discarded, not applied", async () => {
	const h = makeHarness({ enabled: true });
	const handler = createCommandHandler(h.deps);
	// The epoch moves while the confirmation dialog is open: the confirmation
	// was shown for state S and must never apply to a newer state.
	const ctx = h.makeCtx([
		"Add rule",
		"Block command",
		"rm -rf /",
		() => {
			h.settings.epoch += 1;
			return "Save rule";
		},
	]);
	await handler("rules", ctx);
	assert.equal(h.settings.updates.length, 0, "stale confirmation must not commit");
	assert.equal(h.settings.current.blocklist.length, 0);
	assert.match(ctx.notifications.at(-1)?.message ?? "", /changed while you were deciding/);
});

test("rule workflows retain the epoch of the displayed rule list", async () => {
	for (const action of ["add", "delete"] as const) {
		const h = makeHarness({ enabled: true, blocklist: [{ type: "command", text: "old" }] });
		const ctx = h.makeCtx([
			(_title, options) => {
				h.settings.current = makeSettings({ enabled: false, blocklist: [{ type: "command", text: "new" }] });
				h.settings.epoch += 1;
				return action === "add" ? "Add rule" : options[0];
			},
			...(action === "add" ? ["Block command", "another", "Save rule"] : ["Delete", "Delete rule"]),
		]);
		await createCommandHandler(h.deps)("rules", ctx);
		assert.equal(h.settings.updates.length, 0, `${action} must not overwrite a newer configuration`);
		assert.equal(h.settings.current.enabled, false);
		assert.equal(h.settings.current.blocklist[0]?.text, "new");
		assert.match(ctx.notifications.at(-1)?.message ?? "", /changed while you were deciding/);
	}
});

test("classifier consent displays normalized destinations without exposing invalid URL credentials", async () => {
	const h = makeHarness();
	const ctx = h.makeCtx(["Decision Models", undefined, "Close"]);
	await createCommandHandler(h.deps)("", ctx);
	const title = ctx.calls[1]?.title ?? "";
	assert.match(title, /typesafe\/jev-1\.13\.2.*https:\/\/api\.typesafe\.ai\/v1/);
	assert.match(title, /typesafe\/jev-sketchy.*invalid endpoint/);
	assert.doesNotMatch(title, /key@|token=1/);
});

test("managed queue diagnostics live in Details, not the footer or main panel", async () => {
	const h = makeHarness({ enabled: true });
	h.gate.pendingManaged = 3;
	assert.equal(statusText(h.deps), "Automode: On");
	const handler = createCommandHandler(h.deps);
	const ctx = h.makeCtx(["Details", "Back", "Close"]);
	await handler("", ctx);
	assert.doesNotMatch(ctx.calls[0]?.title ?? "", /managed|Settings|Coverage/);
	assert.match(ctx.calls[1]?.title ?? "", /Pending: 3 managed, 0 awaiting approval/);
});
