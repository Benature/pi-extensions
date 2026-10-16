import type { AutomodeSettings, DecisionLog, Rule } from "./types.js";
import { escapeOneLine, escapeTerminal } from "./runtime/escape.js";
import { ambientShellCustomizations, type HostShellOptions } from "./runtime/host.js";
import { normalizeDisclosureEndpoint } from "./core/disclosure.js";
import type { AutomodeHealth } from "./runtime/health.js";

/**
 * Pi-native dialogs: a compact panel, rules, logs and optional shadow review.
 *
 * Authority rules (IMPLEMENTATION.md invariant 6 + B1):
 * - Pi dispatches slash commands BEFORE input hooks and provides no command
 *   origin authentication, so a command invocation alone never authorizes
 *   anything. Every authority change (toggle, rule save/delete, classifier /
 *   consent choice, log clear, re-verify) requires a live local TUI
 *   (ctx.mode === "tui" && ctx.hasUI) AND an explicit host-owned terminal
 *   confirmation whose default is Cancel. RPC (hasUI=true) cannot authorize.
 * - No user data, agent output or extension command invocation can approve,
 *   toggle or save: those paths never reach settings.update without the
 *   confirmed dialog.
 */

const USAGE = "Usage: /automode [on|off|rules|logs]";

/** Minimal UI surface used by the command layer (subset of ExtensionUIContext). */
export interface CommandUi {
	select(
		title: string,
		options: string[],
		opts?: { signal?: AbortSignal; timeout?: number },
	): Promise<string | undefined>;
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }): Promise<string | undefined>;
	editor(title: string, prefill?: string): Promise<string | undefined>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
	setStatus?(key: string, text: string | undefined): void;
}

export interface ClassifierModelInfo {
	provider: string;
	id: string;
	baseUrl?: unknown;
}

export interface CommandModelRegistry {
	getAvailableOfType(type: "classifier", provider?: string): Promise<readonly ClassifierModelInfo[]>;
}

export interface CommandCtx {
	mode: string;
	hasUI: boolean;
	ui: CommandUi;
	modelRegistry?: CommandModelRegistry;
}

export interface UiSettingsStore {
	readonly current: AutomodeSettings;
	readonly epoch: number;
	readonly error: string | null;
	update(next: AutomodeSettings): Promise<void>;
	reload(): Promise<boolean>;
}

export interface UiLogStore {
	read(settings: AutomodeSettings): Promise<DecisionLog[]>;
	clear(): Promise<void>;
}

export interface UiGate {
	readonly state: "off" | "on" | "halted";
	readonly haltReason: string | null;
	/** Managed calls in flight or queued on the execution mutex. */
	readonly pendingManaged: number;
	operatorUpdated(): void;
	reverify(): Promise<{ ok: boolean; error?: string }>;
}

export interface UiApproval {
	readonly pendingCount: number;
}

export interface UiDeps {
	settings: UiSettingsStore;
	logs: UiLogStore;
	gate: UiGate;
	approval: UiApproval;
	dirs: { agentDir: string; workspace: string; extensionDir: string };
	host(): HostShellOptions;
	guardedTools: readonly string[];
	onHealth?: (health: AutomodeHealth) => void;
}

const CANCEL = "Cancel";

export function createCommandHandler(deps: UiDeps): (args: string, ctx: CommandCtx) => Promise<void> {
	return async (args: string, ctx: CommandCtx) => {
		const sub = args.trim();
		switch (sub) {
			case "":
				return showPanel(deps, ctx);
			case "on":
				return setEnabled(deps, ctx, true);
			case "off":
				return setEnabled(deps, ctx, false);
			case "rules":
				return rulesEditor(deps, ctx);
			case "logs":
				return logsViewer(deps, ctx);
			default:
				ctx.ui.notify(`${USAGE} — unknown subcommand "${escapeOneLine(sub)}"`, "error");
		}
	};
}

/** Keep the footer quiet; diagnostics live in Details. */
export function statusText(deps: UiDeps): string {
	const settings = deps.settings.current;
	const state = deps.gate.state;
	if (state === "halted") return "automode · halted — /automode";
	if (state === "off" || !settings?.enabled) return "automode · off";
	return "automode · on";
}

export function refreshStatus(deps: UiDeps, ctx: CommandCtx): void {
	try {
		ctx.ui.setStatus?.("automode", statusText(deps));
	} catch {
		// Status display is best-effort and never authority.
	}
}

/** Live local TUI only. RPC-forwarded dialogs are not authority. */
function requireOperator(ctx: CommandCtx): boolean {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("Automode changes require the interactive terminal; this mode cannot authorize them.", "error");
		return false;
	}
	return true;
}

/**
 * Host-owned terminal confirmation with Cancel as the default/first option.
 * Only the exact confirm label authorizes; Escape/undefined/errors do not.
 */
async function confirmAuthority(ctx: CommandCtx, title: string, detail: string, confirmLabel: string): Promise<boolean> {
	let choice: string | undefined;
	try {
		choice = await ctx.ui.select(detail ? `${title}\n\n${detail}` : title, [CANCEL, confirmLabel]);
	} catch {
		return false;
	}
	return choice === confirmLabel;
}

/**
 * Commit a settings mutation. `expectedEpoch` must have been captured BEFORE
 * the workflow's async dialogs: a confirmation shown for state S can never
 * apply to a newer state — if the settings epoch moved (another verified
 * change, a reload) the stale confirmation is discarded, not applied.
 */
async function saveSettings(
	deps: UiDeps,
	ctx: CommandCtx,
	next: AutomodeSettings,
	expectedEpoch: number,
	healthEnabled?: boolean,
): Promise<boolean> {
	if (deps.settings.epoch !== expectedEpoch) {
		ctx.ui.notify("Automode: settings changed while you were deciding; nothing was saved — review and retry.", "warning");
		return false;
	}
	try {
		await deps.settings.update(next);
	} catch (error) {
		ctx.ui.notify(`Automode: could not save settings (${error instanceof Error ? error.message : String(error)})`, "error");
		return false;
	}
	deps.onHealth?.({
		initialized: true,
		guardedTools: [...deps.guardedTools],
		enabled: healthEnabled ?? next.enabled,
		...(deps.settings.error ? { error: String(deps.settings.error) } : {}),
	});
	return true;
}

async function setEnabled(deps: UiDeps, ctx: CommandCtx, on: boolean): Promise<void> {
	if (!requireOperator(ctx)) return;
	const epoch0 = deps.settings.epoch;
	const current = deps.settings.current;
	if (!current) {
		ctx.ui.notify("Automode: no valid configuration; fix automode.json first.", "error");
		return;
	}
	if (current.enabled === on && deps.gate.state !== "halted") {
		ctx.ui.notify(on ? "Automode is already on." : "Automode is already off.", "info");
		return;
	}
	const title = on ? "Turn Automode ON?" : "Turn Automode OFF?";
	const detail = on
		? "Check read, edit, write and bash. Other tools, including codemode and MCP, are blocked. " +
			"Not a sandbox: approved commands run with your permissions."
		: "Disable all Automode checks. Pending approvals are cancelled, not executed.";
	const confirmed = await confirmAuthority(ctx, title, detail, on ? "Turn on" : "Turn off");
	if (!confirmed) return;
	if (!(await saveSettings(deps, ctx, { ...current, enabled: on }, epoch0, on))) return;
	// Clears any halt and invalidates pending asks/reviews; Off never releases
	// held calls into execution, On never retroactively re-holds work.
	deps.gate.operatorUpdated();
	refreshStatus(deps, ctx);
	ctx.ui.notify(on ? "Automode is on." : "Automode is off.", "info");
}

async function showPanel(deps: UiDeps, ctx: CommandCtx): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Automode panel requires UI.", "error");
		return;
	}
	for (;;) {
		const settings = deps.settings.current;
		const state = deps.gate.state;
		const lines = [state === "halted"
			? `Halted: ${escapeOneLine(deps.gate.haltReason ?? "configuration needs verification", 160)}`
			: settings?.enabled
				? "On — ordinary workspace files can run; other actions may need approval."
				: "Off — tool calls run without Automode checks."];
		if (deps.settings.error) lines.push(`Config error: ${escapeOneLine(String(deps.settings.error), 160)}`);
		if (ambientShellCustomizations(deps.host()).length) lines.push("Shell customization detected: bash is blocked while on.");
		if (ctx.mode !== "tui") lines.push("Changes and approvals require the interactive terminal.");
		if (deps.approval.pendingCount) lines.push(`${deps.approval.pendingCount} awaiting approval`);
		const toggle = settings?.enabled ? "Turn off" : "Turn on";
		const options = [toggle, "Rules", "Logs", "Classifier (optional)", "Details"];
		if (state === "halted") options.unshift("Re-verify configuration");
		options.push("Close");

		let choice: string | undefined;
		try {
			choice = await ctx.ui.select(`Automode\n\n${lines.join("\n")}`, options);
		} catch {
			return;
		}
		if (choice === toggle) await setEnabled(deps, ctx, !settings?.enabled);
		else if (choice === "Rules") await rulesEditor(deps, ctx);
		else if (choice === "Logs") await logsViewer(deps, ctx);
		else if (choice === "Classifier (optional)") await classifierPicker(deps, ctx);
		else if (choice === "Details") await showDetails(deps, ctx);
		else if (choice === "Re-verify configuration") await reverify(deps, ctx);
		else return;
		refreshStatus(deps, ctx);
	}
}

async function showDetails(deps: UiDeps, ctx: CommandCtx): Promise<void> {
	const settings = deps.settings.current;
	const classifier = settings.classifier;
	const count = (rules: Rule[]) => rules.filter((r) => r.enabled !== false).length;
	const lines = [
		`Tools checked: ${deps.guardedTools.join(", ")}. Other tools and nested calls are blocked while on.`,
		"Protected writes are blocked. Approved shell commands are not sandboxed.",
		`Rules: ${count(settings.blocklist)} block, ${count(settings.allowlist)} allow`,
		`Classifier: ${classifier ? `${escapeOneLine(classifier.provider)}/${escapeOneLine(classifier.model)} (shadow only; consent: ${settings.disclosureConsent})` : "none — local checks only"}`,
		`Pending: ${deps.gate.pendingManaged} managed, ${deps.approval.pendingCount} awaiting approval`,
		`Settings: ${escapeOneLine(deps.dirs.agentDir)}/automode.json`,
		`Logs: local; retained ${settings.logRetentionDays} days, up to ${settings.logMaxEntries} entries`,
	];
	await ctx.ui.select(`Automode details\n\n${lines.join("\n")}`, ["Back"]);
}

async function reverify(deps: UiDeps, ctx: CommandCtx): Promise<void> {
	if (!requireOperator(ctx)) return;
	const confirmed = await confirmAuthority(
		ctx,
		"Re-verify configuration?",
		"The current automode.json on disk becomes the reviewed configuration. Only confirm if you expected its contents.",
		"Re-verify",
	);
	if (!confirmed) return;
	const result = await deps.gate.reverify();
	ctx.ui.notify(
		result.ok ? "Configuration re-verified; guard state restored." : `Still halted: ${result.error ?? "unknown error"}`,
		result.ok ? "info" : "error",
	);
	refreshStatus(deps, ctx);
}

// ---------------------------------------------------------------- rules

function ruleLine(list: "allow" | "block", rule: Rule): string {
	const flags = rule.enabled === false ? " · disabled" : "";
	return `[${list} · ${rule.type}${flags}] ${escapeOneLine(rule.text, 120)}`;
}

interface RuleRef {
	list: "allowlist" | "blocklist";
	index: number;
	rule: Rule;
}

const RULE_ADD = "Add rule";
const RULE_DONE = "Done";

async function rulesEditor(deps: UiDeps, ctx: CommandCtx): Promise<void> {
	if (!requireOperator(ctx)) return;
	for (;;) {
		const current = deps.settings.current;
		if (!current) {
			ctx.ui.notify("Automode: no valid configuration; fix automode.json first.", "error");
			return;
		}
		const refs: (RuleRef | typeof RULE_ADD | typeof RULE_DONE)[] = [];
		const options: string[] = [];

		for (const [list, rules] of [
			["blocklist", current.blocklist],
			["allowlist", current.allowlist],
		] as const) {
			rules.forEach((rule, index) => {
				// Positional prefix: duplicate rule texts produce identical labels,
				// so selection keys on the unique position, never the label bytes.
				options.push(`${options.length + 1}. ${ruleLine(list === "allowlist" ? "allow" : "block", rule)}`);
				refs.push({ list, index, rule });
			});
		}
		options.push(RULE_ADD, RULE_DONE);
		refs.push(RULE_ADD, RULE_DONE);

		let choice: string | undefined;
		try {
			choice = await ctx.ui.select(current.allowlist.length + current.blocklist.length === 0
				? "Automode rules — no rules yet. Workspace file checks still apply."
				: "Automode rules — block rules take priority", options);
		} catch {
			return;
		}
		const ref = choice === undefined ? RULE_DONE : refs[options.indexOf(choice)];
		if (ref === undefined || ref === RULE_DONE) return;
		if (ref === RULE_ADD) {
			await addRule(deps, ctx, current);
			continue;
		}
		await editRule(deps, ctx, current, ref);
	}
}

async function addRule(deps: UiDeps, ctx: CommandCtx, current: AutomodeSettings): Promise<void> {
	const epoch0 = deps.settings.epoch;
	const choices = ["Allow command", "Block command", "Allow message", "Block message"];
	const choice = await ctx.ui.select("Add rule — command rules match exact text", [...choices, CANCEL]);
	if (!choice || !choices.includes(choice)) return;
	const effect = choice.startsWith("Allow") ? "allow" : "block";
	const type: Rule["type"] = choice.endsWith("command") ? "command" : "message";
	const title = type === "command"
		? "Exact command — whitespace matters; complex allow commands still ask"
		: effect === "block"
			? "Message rule — while enabled, ALL otherwise allowed actions ask for approval"
			: "Message rule — shadow review only; never auto-approves actions";
	const text = await ctx.ui.editor(title);
	if (text === undefined || text.length === 0) return;
	const rule: Rule = { type, text };
	const confirmed = await confirmAuthority(
		ctx,
		"Save rule?",
		`${effect} ${type} rule:\n${escapeTerminal(text, { multiline: true })}`,
		"Save rule",
	);
	if (!confirmed) return;
	const next: AutomodeSettings =
		effect === "allow"
			? { ...current, allowlist: [...current.allowlist, rule] }
			: { ...current, blocklist: [...current.blocklist, rule] };
	if (await saveSettings(deps, ctx, next, epoch0)) ctx.ui.notify("Rule saved.", "info");
}

async function editRule(deps: UiDeps, ctx: CommandCtx, current: AutomodeSettings, ref: RuleRef): Promise<void> {
	const epoch0 = deps.settings.epoch;
	const toggleLabel = ref.rule.enabled === false ? "Enable" : "Disable";
	const moveLabel = ref.list === "allowlist" ? "Move to blocklist" : "Move to allowlist";
	const choice = await ctx.ui.select(`${ruleLine(ref.list === "allowlist" ? "allow" : "block", ref.rule)}`, [
		"Back",
		"Edit text",
		toggleLabel,
		moveLabel,
		"Delete",
	]);
	if (choice === undefined || choice === "Back") return;

	const lists = () => ({ allowlist: [...current.allowlist], blocklist: [...current.blocklist] });

	if (choice === "Edit text") {
		const text = await ctx.ui.editor("Edit rule — saved verbatim", ref.rule.text);
		if (text === undefined || text.length === 0) return;
		const confirmed = await confirmAuthority(
			ctx,
			"Save rule edit?",
			escapeTerminal(text, { multiline: true }),
			"Save rule",
		);
		if (!confirmed) return;
		const next = lists();
		next[ref.list][ref.index] = { ...ref.rule, text };
		if (await saveSettings(deps, ctx, { ...current, ...next }, epoch0)) ctx.ui.notify("Rule saved.", "info");
		return;
	}
	if (choice === toggleLabel) {
		const confirmed = await confirmAuthority(
			ctx,
			ref.rule.enabled === false ? "Enable rule?" : "Disable rule?",
			ruleLine(ref.list === "allowlist" ? "allow" : "block", ref.rule),
			ref.rule.enabled === false ? "Enable rule" : "Disable rule",
		);
		if (!confirmed) return;
		const next = lists();
		next[ref.list][ref.index] = { ...ref.rule, enabled: ref.rule.enabled === false };
		if (await saveSettings(deps, ctx, { ...current, ...next }, epoch0)) {
			ctx.ui.notify(ref.rule.enabled === false ? "Rule enabled." : "Rule disabled.", "info");
		}
		return;
	}
	if (choice === moveLabel) {
		const confirmed = await confirmAuthority(ctx, "Change rule effect?", ruleLine(ref.list === "allowlist" ? "allow" : "block", ref.rule), "Move rule");
		if (!confirmed) return;
		const next = lists();
		next[ref.list].splice(ref.index, 1);
		const target = ref.list === "allowlist" ? "blocklist" : "allowlist";
		next[target].push(ref.rule);
		if (await saveSettings(deps, ctx, { ...current, ...next }, epoch0)) ctx.ui.notify("Rule moved.", "info");
		return;
	}
	if (choice === "Delete") {
		const confirmed = await confirmAuthority(
			ctx,
			"Delete rule?",
			ruleLine(ref.list === "allowlist" ? "allow" : "block", ref.rule),
			"Delete rule",
		);
		if (!confirmed) return;
		const next = lists();
		next[ref.list].splice(ref.index, 1);
		if (await saveSettings(deps, ctx, { ...current, ...next }, epoch0)) ctx.ui.notify("Rule deleted.", "info");
	}
}

// ---------------------------------------------------------------- logs

const LOGS_CLEAR = "Clear logs";
const LOGS_CLOSE = "Close";

function logLine(entry: DecisionLog): string {
	const summary =
		entry.action.tool === "bash"
			? `$ ${String(entry.action.args.command ?? "")}`
			: `${escapeOneLine(entry.action.tool, 40)} ${String(entry.action.args.path ?? "")}`;
	return `${escapeOneLine(entry.time, 40)} ${entry.outcome.toUpperCase()} · ${escapeOneLine(entry.source, 80)} — ${escapeOneLine(summary, 120)}`;
}

function logDetail(entry: DecisionLog): string {
	const lines = [
		`id: ${escapeTerminal(entry.id)}`,
		`time: ${escapeTerminal(entry.time)}`,
		`outcome: ${entry.outcome}`,
		`source: ${escapeTerminal(entry.source)}`,
		`reason: ${escapeTerminal(entry.reason, { multiline: true })}`,
		`action: ${escapeTerminal(entry.action.tool)} ${escapeTerminal(JSON.stringify(entry.action.args, null, 2) ?? "", { multiline: true })}`,
		`cwd: ${escapeTerminal(entry.action.cwd)}`,
	];
	if (entry.matchedRule) {
		lines.push(`matched rule: [${entry.matchedRule.type}] ${escapeTerminal(entry.matchedRule.text, { multiline: true })}`);
	}
	lines.push(
		entry.classifier !== undefined
			? `classifier: ${escapeTerminal(JSON.stringify(entry.classifier), { multiline: true })}`
			: "classifier: not captured",
		entry.input !== undefined
			? `input: ${escapeTerminal(JSON.stringify(entry.input), { multiline: true })}`
			: "input: not captured",
		entry.output !== undefined
			? `output: ${escapeTerminal(JSON.stringify(entry.output), { multiline: true })}`
			: "output: not captured",
	);
	return lines.join("\n");
}

async function logsViewer(deps: UiDeps, ctx: CommandCtx): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Automode logs require UI.", "error");
		return;
	}
	for (;;) {
		const settings = deps.settings.current;
		if (!settings) {
			ctx.ui.notify("Automode: no valid configuration; fix automode.json first.", "error");
			return;
		}
		let entries: DecisionLog[];
		try {
			entries = await deps.logs.read(settings);
		} catch (error) {
			ctx.ui.notify(
				`Automode: decision log unavailable (${error instanceof Error ? error.message : String(error)})`,
				"error",
			);
			return;
		}
		const options: string[] = [];
		const byLine = new Map<string, DecisionLog>();
		for (const entry of [...entries].reverse()) {
			const line = `${options.length + 1}. ${logLine(entry)}`;
			options.push(line);
			byLine.set(line, entry);
		}
		if (entries.length && ctx.mode === "tui") options.push(LOGS_CLEAR);
		options.push(LOGS_CLOSE);
		let choice: string | undefined;
		try {
			choice = await ctx.ui.select(
				entries.length ? "Automode logs — newest first" : "Automode logs — no decisions recorded yet",
				options,
			);
		} catch {
			return;
		}
		if (choice === undefined || choice === LOGS_CLOSE) return;
		if (choice === LOGS_CLEAR) {
			if (!requireOperator(ctx)) return;
			const confirmed = await confirmAuthority(ctx, "Clear decision logs?", "All recorded decisions are deleted locally.", "Clear logs");
			if (confirmed) {
				try {
					await deps.logs.clear();
					ctx.ui.notify("Decision logs cleared.", "info");
				} catch (error) {
					ctx.ui.notify(`Could not clear logs: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
			}
			continue;
		}
		const entry = byLine.get(choice);
		if (!entry) continue;
		try {
			await ctx.ui.select(`Decision detail\n\n${logDetail(entry)}`, [LOGS_CLOSE]);
		} catch {
			return;
		}
	}
}

// ---------------------------------------------------------------- review / classifier

const PICKER_RULES_ONLY = "Rules only (no classifier)";
const PICKER_CANCEL = CANCEL;
const CONSENT_APPROVE = "Approve disclosure";
const CONSENT_DECLINE = "Decline disclosure";

async function classifierPicker(deps: UiDeps, ctx: CommandCtx): Promise<void> {
	if (!requireOperator(ctx)) return;
	// Bind the settings epoch before any async work: a consent choice shown
	// for one configuration must never be applied to a newer one.
	const epoch0 = deps.settings.epoch;
	const registry = ctx.modelRegistry;
	if (!registry || typeof registry.getAvailableOfType !== "function") {
		ctx.ui.notify("Automode: model registry unavailable.", "error");
		return;
	}
	let models: readonly ClassifierModelInfo[];
	try {
		// Classifier-typed entries only; the coding/chat model never changes.
		models = await registry.getAvailableOfType("classifier");
	} catch (error) {
		ctx.ui.notify(`Automode: could not list classifiers (${error instanceof Error ? error.message : String(error)})`, "error");
		return;
	}
	const modelLabels = models.map((m, index) => `${index + 1}. ${escapeOneLine(`${m.provider} / ${m.id}`)}`);
	const options = [
		PICKER_RULES_ONLY,
		...modelLabels,
		PICKER_CANCEL,
	];
	const choice = await ctx.ui.select(
		"Optional shadow review — never approves actions. Your coding model stays unchanged.",
		options,
	);
	if (choice === undefined || choice === PICKER_CANCEL) return;

	const current = deps.settings.current;
	if (!current) {
		ctx.ui.notify("Automode: no valid configuration; fix automode.json first.", "error");
		return;
	}

	if (choice === PICKER_RULES_ONLY) {
		const confirmed = await confirmAuthority(
			ctx,
			"Switch to Rules only?",
			"No evidence leaves this machine. The deterministic floor and exact command rules still apply; everything unresolved asks.",
			"Switch to Rules",
		);
		if (!confirmed) return;
		const next: AutomodeSettings = {
			...current,
			classifier: null,
			disclosureConsent: "none",
			disclosureProvider: null,
			disclosureModel: null,
			disclosureEndpoint: null,
			disclosureWorkspace: null,
		};
		if (await saveSettings(deps, ctx, next, epoch0)) ctx.ui.notify("Rules mode. Nothing is uploaded.", "info");
		return;
	}

	const model = models[modelLabels.indexOf(choice)];
	if (!model) return;
	const endpoint = normalizeDisclosureEndpoint(typeof model.baseUrl === "string" ? model.baseUrl : "");
	const selection = { provider: model.provider, model: model.id };

	if (endpoint === null) {
		ctx.ui.notify("Invalid classifier endpoint (missing or contains credentials/query/fragment). Selection unchanged; no consent granted for this model.", "warning");
		return;
	}

	const detail =
		`Provider/model: ${escapeOneLine(model.provider)} / ${escapeOneLine(model.id)}\n` +
		`Endpoint: ${escapeOneLine(endpoint)}\n` +
		`Workspace: ${escapeOneLine(deps.dirs.workspace)}\n\n` +
		"When an action cannot be settled locally, bounded metadata — the tool name, argument key names, " +
		"path metadata and your message-rule text, never argument values or file bodies — " +
		"may leave this machine to exactly this endpoint. Retention follows the provider's current terms; no zero-retention claim. " +
		"Consent binds this provider/model, endpoint and workspace; any change resets it. Shadow review never auto-approves.";
	const consent = await ctx.ui.select(
		`Disclosure consent\n\n${detail}`,
		[CONSENT_DECLINE, CONSENT_APPROVE],
	);
	if (consent !== CONSENT_APPROVE && consent !== CONSENT_DECLINE) return;
	// A confirmed change resets consent; Escape leaves the existing selection intact.
	if (consent === CONSENT_APPROVE) {
		const next: AutomodeSettings = {
			...current,
			classifier: selection,
			disclosureConsent: "approved",
			disclosureProvider: model.provider,
			disclosureModel: model.id,
			disclosureEndpoint: endpoint,
			disclosureWorkspace: deps.dirs.workspace,
		};
		if (await saveSettings(deps, ctx, next, epoch0)) ctx.ui.notify("Disclosure approved for this provider/model, endpoint and workspace.", "info");
		return;
	}
	const next: AutomodeSettings = {
		...current,
		classifier: selection,
		disclosureConsent: "declined",
		disclosureProvider: null,
		disclosureModel: null,
		disclosureEndpoint: null,
		disclosureWorkspace: null,
	};
	if (await saveSettings(deps, ctx, next, epoch0)) {
		ctx.ui.notify("Disclosure declined — nothing is sent.", "info");
	}
}
