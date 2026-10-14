import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	CREDENTIAL_ENV_ALIASES,
	CREDENTIAL_PROVIDER_IDS,
	type CredentialProviderId,
	githubToken,
	inspectStoredCredential,
	removeStoredApiKey,
	resolveCredential,
	storeApiKey,
} from "./env.ts";
import {
	configureJudgment,
	parseJudgmentArgs,
	resolveSettings,
	type AvailableClassifier,
	type JudgmentAction,
} from "./providers/config.ts";
import {
	PROVIDER_KINDS,
	type ProviderKind,
} from "./providers/types.ts";
import { awaitWithSignal, withTimeout } from "./providers/http.ts";

export const WEB_SEARCH_USAGE =
	"Usage: /web-search [status|provider [name]|classifier [none|provider/model]]. Keys are never accepted as arguments.";

const LOGIN = "Login";
const ADD_API_KEY = "Add API key";
const LOGOUT = "Logout";

export const WEB_SEARCH_COMMAND = "web-search";
export const WEB_SEARCH_SETTINGS_ALIAS = "web-search-settings";

export type WebSearchAction =
	| { kind: "menu" }
	| { kind: "status" }
	| { kind: "provider"; id?: ProviderKind }
	| { kind: "classifier"; action: JudgmentAction | "pick" }
	| { kind: "usage" };

const PROVIDER_KIND_SET = new Set<string>(PROVIDER_KINDS);
const KEYED_PROVIDER_IDS = new Set<string>(CREDENTIAL_PROVIDER_IDS);

export const PROVIDER_AUTH: Record<
	ProviderKind,
	{ key: "none" | "optional" | "required"; summary: string }
> = {
	exa: { key: "optional", summary: "keyless MCP; key selects REST" },
	parallel: { key: "optional", summary: "keyless MCP; key raises limits" },
	grep: { key: "none", summary: "keyless" },
	sourcegraph: { key: "none", summary: "keyless" },
	github: { key: "required", summary: "token or gh auth" },
};

export function parseWebSearchArgs(args: string): WebSearchAction {
	const trimmed = args.trim();
	if (trimmed.length === 0) {
		return { kind: "menu" };
	}
	const parts = trimmed.split(/\s+/);
	const [head, ...rest] = parts;
	if (head === "status") {
		return { kind: "status" };
	}
	if (head === "provider") {
		if (rest.length === 0) {
			return { kind: "provider" };
		}
		const id = rest[0];
		if (!id || !PROVIDER_KIND_SET.has(id)) {
			return { kind: "usage" };
		}
		if (rest.length === 1) {
			return { kind: "provider", id: id as ProviderKind };
		}
		return { kind: "usage" };
	}
	if (head === "classifier") {
		if (rest.length === 0) {
			return { kind: "classifier", action: "pick" };
		}
		if (rest.length === 1 && rest[0] === "none") {
			return { kind: "classifier", action: "off" };
		}
		const pin = parseJudgmentArgs(rest.join(" "));
		if (pin && pin !== "status" && pin !== "on" && pin !== "off") {
			return { kind: "classifier", action: pin };
		}
		return { kind: "usage" };
	}
	if (trimmed === "on" || trimmed === "off") {
		return { kind: "classifier", action: trimmed };
	}
	return { kind: "usage" };
}

export function webSearchCompletions(prefix: string): { value: string; label: string }[] {
	const trimmed = prefix.trimStart();
	const parts = trimmed.length === 0 ? [""] : trimmed.split(/\s+/);
	const completing = prefix.endsWith(" ") ? "" : (parts.at(-1) ?? "");
	const head = prefix.endsWith(" ") ? (parts[0] ?? "") : (parts.length > 1 ? parts[0] : "");
	if (head === "provider") {
		const tokens = trimmed.split(/\s+/).filter(Boolean);
		if (tokens.length === 1) {
			return filterCompletions([...PROVIDER_KINDS], prefix.endsWith(" ") ? "" : completing);
		}
		if (tokens.length === 2 && !prefix.endsWith(" ")) {
			return filterCompletions([...PROVIDER_KINDS], tokens[1] ?? "");
		}
		return [];
	}
	if (head === "classifier") {
		return filterCompletions(["none"], completing);
	}
	if (parts.length <= 1 && !prefix.endsWith(" ")) {
		return filterCompletions(
			["status", "provider", "classifier", "on", "off"],
			completing,
		);
	}
	return [];
}

function filterCompletions(values: readonly string[], prefix: string) {
	return values
		.filter((value) => value.startsWith(prefix))
		.map((value) => ({ value, label: value }));
}

export async function handleWebSearchCommand(
	args: string,
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui" | "modelRegistry" | "signal">,
	pi: Pick<ExtensionAPI, "sendMessage">,
): Promise<void> {
	const parsed = parseWebSearchArgs(args);
	let report: string | undefined;
	try {
		if (parsed.kind === "usage") {
			report = WEB_SEARCH_USAGE;
		} else if (parsed.kind === "menu") {
			report = ctx.hasUI
				? await runMenu(ctx)
				: await buildSettingsReport(ctx.modelRegistry);
		} else if (parsed.kind === "status") {
			report = await buildSettingsReport(ctx.modelRegistry);
		} else if (parsed.kind === "provider") {
			report = await runProvider(parsed.id, ctx);
		} else {
			report = await runClassifier(parsed.action, ctx);
		}
	} catch (error) {
		report = error instanceof ClassifierDiscoveryError
			? error.message
			: error instanceof Error && /auth\.json|API key is empty|Malformed configuration|Could not update/.test(error.message)
				? error.message
				: parsed.kind === "provider"
					? "Could not update the stored key. Check auth.json and permissions. Malformed files are never overwritten."
					: "Could not update search settings. Check the config file and permissions. Malformed configuration is never overwritten.";
	}
	if (!report) {
		return;
	}
	if (ctx.hasUI) {
		ctx.ui.notify(report, "info");
	} else {
		pi.sendMessage({ customType: WEB_SEARCH_COMMAND, content: report, display: true });
	}
}

async function runMenu(
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui" | "modelRegistry" | "signal">,
): Promise<string | undefined> {
	const setting = await ctx.ui.select("Web Search", ["Status", "Providers", "Classifier"]);
	if (setting === "Status") {
		return buildSettingsReport(ctx.modelRegistry);
	}
	if (setting === "Providers") {
		return runProvider(undefined, ctx);
	}
	if (setting === "Classifier") {
		return runClassifier("pick", ctx);
	}
	return undefined;
}

async function runProvider(
	id: ProviderKind | undefined,
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui" | "modelRegistry" | "signal">,
): Promise<string | undefined> {
	const selected = id ?? (ctx.hasUI ? await pickProvider(ctx) : undefined);
	if (!selected) {
		return ctx.hasUI ? undefined : `${WEB_SEARCH_USAGE}\nInteractive Pi can log in with /web-search provider.`;
	}
	const auth = PROVIDER_AUTH[selected];
	if (auth.key === "none") {
		return `${selected}: keyless. No login or API key is used.`;
	}
	if (!ctx.hasUI) {
		return [
			`${selected}: ${keyRequirement(auth.key)} — ${auth.summary} · ${presenceLabel(selected as CredentialProviderId)}.`,
			"In interactive Pi: Login, Add API key, or Logout. Keys cannot be collected or removed without the TUI.",
		].join("\n");
	}
	return editProviderAuth(selected as CredentialProviderId, ctx);
}

async function pickProvider(
	ctx: Pick<ExtensionCommandContext, "ui">,
): Promise<ProviderKind | undefined> {
	const options = PROVIDER_KINDS.map((id) => providerOption(id));
	const chosen = await ctx.ui.select("Search provider", options);
	if (!chosen) {
		return undefined;
	}
	return PROVIDER_KINDS.find((id) => chosen.startsWith(`${id} `) || chosen === id);
}

function providerOption(id: ProviderKind): string {
	const auth = PROVIDER_AUTH[id];
	const presence = KEYED_PROVIDER_IDS.has(id)
		? presenceLabel(id as CredentialProviderId)
		: "no key";
	return `${id} · ${keyRequirement(auth.key)} · ${auth.summary} · ${presence}`;
}

function keyRequirement(kind: "none" | "optional" | "required"): string {
	if (kind === "none") {
		return "keyless";
	}
	return kind === "required" ? "key required" : "key optional";
}

function presenceLabel(id: CredentialProviderId): string {
	const found = resolveCredential(id);
	if (found) {
		return found.source === "env" ? `present via ${found.name}` : "present via auth.json";
	}
	if (id === "github" && githubToken() !== undefined) {
		return "present via gh auth";
	}
	return "missing";
}

async function editProviderAuth(
	id: CredentialProviderId,
	ctx: Pick<ExtensionCommandContext, "ui">,
): Promise<string | undefined> {
	const action = await ctx.ui.select(
		`${id} (${keyRequirement(PROVIDER_AUTH[id].key)} · ${presenceLabel(id)})`,
		[LOGIN, ADD_API_KEY, LOGOUT],
	);
	if (action === LOGOUT) {
		return logoutProvider(id, ctx);
	}
	if (action === LOGIN || action === ADD_API_KEY) {
		return loginProvider(id, action === LOGIN ? "login" : "key", ctx);
	}
	return undefined;
}

async function loginProvider(
	id: CredentialProviderId,
	mode: "login" | "key",
	ctx: Pick<ExtensionCommandContext, "ui">,
): Promise<string | undefined> {
	const stored = inspectStoredCredential(id);
	const title = mode === "login"
		? `Log in to ${id} (API key saved to auth.json; never shown again)`
		: `${id} API key (saved to auth.json; never shown again)`;
	const key = await ctx.ui.input(title);
	if (key === undefined) {
		return undefined;
	}
	if (key.trim().length === 0) {
		return "API key is empty. Nothing was stored.";
	}
	if (stored?.type === "oauth") {
		const replace = await ctx.ui.confirm(
			"Replace OAuth credential?",
			`auth.json already has an OAuth entry for ${id}. Replace it with an API key?`,
		);
		if (!replace) {
			return undefined;
		}
	} else if (!await ctx.ui.confirm(
		mode === "login" ? `Log in to ${id}?` : "Store API key?",
		`Save the ${id} key to auth.json? It will not be shown again.`,
	)) {
		return undefined;
	}
	const saved = await storeApiKey(id, key);
	const env = resolveCredential(id, { env: process.env, readCredential: () => undefined });
	const lines = [
		mode === "login" ? `Logged in to ${id}.` : `Stored ${id} key in ${saved.path}.`,
		id === "parallel" ? "Run /reload so Parallel MCP picks up the new header." : undefined,
		env ? `${env.name} is set and still takes precedence until you unset it.` : undefined,
	].filter((line): line is string => line !== undefined);
	return lines.join("\n");
}

async function logoutProvider(
	id: CredentialProviderId,
	ctx: Pick<ExtensionCommandContext, "ui">,
): Promise<string | undefined> {
	const stored = inspectStoredCredential(id);
	if (!stored) {
		return `${id}: not logged in via auth.json. Environment and gh auth are unchanged.`;
	}
	if (!await ctx.ui.confirm(
		`Log out of ${id}?`,
		`Remove the stored ${id} entry from auth.json? The value is never shown.`,
	)) {
		return undefined;
	}
	const result = await removeStoredApiKey(id);
	if (!result.removed) {
		return `${id}: not logged in via auth.json.`;
	}
	return id === "parallel"
		? `Logged out of ${id}. Run /reload so Parallel MCP drops the header.`
		: `Logged out of ${id}.`;
}

async function runClassifier(
	action: JudgmentAction | "pick",
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui" | "modelRegistry" | "signal">,
): Promise<string | undefined> {
	const selection = action === "pick"
		? await pickClassifier(ctx)
		: action;
	if (selection === undefined) {
		return ctx.hasUI ? undefined : `${WEB_SEARCH_USAGE}\nInteractive Pi can pick a classifier with /web-search classifier.`;
	}
	const saved = await configureJudgment(
		selection,
		selection === "on" ? () => availableClassifiers(ctx.modelRegistry, ctx.signal) : [],
	);
	return `Saved search settings to ${saved.path}. Run /reload to apply tool exposure changes.${saved.note ? `\n${saved.note}` : ""}\n\n${await buildSettingsReport(ctx.modelRegistry)}`;
}

async function pickClassifier(
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui" | "modelRegistry" | "signal">,
): Promise<JudgmentAction | undefined> {
	if (!ctx.hasUI) {
		return undefined;
	}
	const resolved = await resolveSettings();
	const current = !("error" in resolved) && resolved.jev.provider && resolved.jev.model
		? `${resolved.jev.provider}/${resolved.jev.model}`
		: undefined;
	const models = await listSupportedClassifiers(ctx.modelRegistry, ctx.signal);
	const options = [
		"None",
		...models.map((model) => classifierOption(model, current)),
	];
	const chosen = await ctx.ui.select("Classifier", options);
	if (!chosen) {
		return undefined;
	}
	if (chosen === "None" || chosen === "None (default)") {
		return "off";
	}
	const match = models.find((model) => chosen.startsWith(`${model.provider}/${model.id} `) || chosen === `${model.provider}/${model.id}`);
	return match;
}

function classifierOption(model: ListedClassifier, current: string | undefined): string {
	const pin = `${model.provider}/${model.id}`;
	const ready = model.available === true
		? "available"
		: model.available === false
			? "login required"
			: "registered";
	const mark = current === pin ? "current" : ready;
	return current === pin ? `${pin} · current · ${ready}` : `${pin} · ${mark}`;
}

interface ListedClassifier extends AvailableClassifier {
	available?: boolean;
}

export async function listSupportedClassifiers(
	registry: ExtensionContext["modelRegistry"] | undefined,
	signal?: AbortSignal,
): Promise<ListedClassifier[]> {
	if (!registry) {
		return [];
	}
	const known = (registry.getModelsOfType?.("classifier") ?? []).map((model) => ({
		provider: model.provider,
		id: model.id,
	}));
	let available: AvailableClassifier[];
	try {
		available = await availableClassifiers(registry, signal);
	} catch {
		available = [];
	}
	const ready = new Set(available.map((model) => `${model.provider}/${model.id}`));
	const listed = known.map((model) => ({
		...model,
		available: ready.has(`${model.provider}/${model.id}`),
	}));
	if (listed.length > 0) {
		return listed;
	}
	return available.map((model) => ({ ...model, available: true }));
}

/**
 * Report retrieval credential presence and Pi's classifier auth snapshot, never keys.
 * No classifier requests or credential re-resolution are made here.
 */
export async function buildSettingsReport(registry: ExtensionContext["modelRegistry"] | undefined): Promise<string> {
	const resolved = await resolveSettings();
	if ("error" in resolved) {
		return [
			"pi-web-search settings",
			`config: ${resolved.error.configPath}`,
			`error: ${resolved.error.message}`,
			"Fix the file, then run /reload.",
		].join("\n");
	}

	const pin = resolved.jev.provider && resolved.jev.model
		? `${resolved.jev.provider}/${resolved.jev.model}`
		: "unpinned";
	const list = (kinds: readonly string[]) =>
		kinds.length > 0 ? kinds.join(", ") : "none";
	const lines: string[] = [
		"pi-web-search settings",
		`config: ${resolved.configPath}`,
		`web_search: ${resolved.web.provider} (fallback: ${list(resolved.web.fallback)})`,
		`code_search: ${resolved.code.provider} (fallback: ${list(resolved.code.fallback)})`,
		`multi_search: ${resolved.researchEnabled ? "enabled" : "disabled"}`,
		`jev: ${resolved.jev.enabled ? `enabled (${pin})` : "disabled"}`,
		"",
		"Search credentials (presence only; keys are never shown):",
	];
	for (const id of PROVIDER_KINDS) {
		const auth = PROVIDER_AUTH[id];
		if (auth.key === "none") {
			lines.push(`- ${id}: keyless`);
			continue;
		}
		const found = resolveCredential(id as CredentialProviderId);
		const aliases = CREDENTIAL_ENV_ALIASES[id as CredentialProviderId].join(" or ");
		const viaGh = id === "github" && found === undefined && githubToken() !== undefined;
		lines.push(
			found
				? `- ${id}: ${keyRequirement(auth.key)} — present via ${found.source === "env" ? found.name : "auth.json"}`
				: viaGh
					? `- github: ${keyRequirement(auth.key)} — present via gh auth`
					: `- ${id}: ${keyRequirement(auth.key)} — ${auth.summary}; set ${aliases}, ${id === "github" ? "run gh auth login, " : ""}add "${id}" to auth.json, or /web-search provider ${id}`,
		);
	}
	if (resolved.jev.provider && resolved.jev.model) {
		const auth = registry?.getProviderAuthStatus?.(resolved.jev.provider);
		const registered = registry?.findOfType?.("classifier", resolved.jev.provider, resolved.jev.model);
		lines.push(
			"",
			"Pinned classifier (Pi snapshot; not a live credential test):",
			`- ${resolved.jev.provider}/${resolved.jev.model}: ${auth?.configured ? "Pi auth configured" : registry ? "Pi auth not configured" : "Pi auth status unavailable"}; ${registered ? "registered" : "not registered"}.`,
		);
	}
	lines.push(
		"",
		"Setup:",
		"- /web-search opens Status, Providers, and Classifier.",
		"- /web-search provider: Login, Add API key, or Logout. Keys are never command arguments.",
		"- /web-search classifier lists Pi classifiers, plus None. /model does not list them.",
		"- Judgment uses one exact Pi classifier. No separate Jev key; provider billing applies.",
		"- /web-search classifier none disables judgment. Nonsecret settings live in web-search.json.",
		"- Run /reload after changing multi_search exposure or a Parallel credential (its MCP header is captured at registration).",
		"- Install from a repository checkout: pi install ./pi-web-search",
		"- After an npm release is available: pi install npm:@gagansd/pi-web-search",
	);
	return lines.join("\n");
}

export class ClassifierDiscoveryError extends Error {}

export async function availableClassifiers(
	registry: ExtensionContext["modelRegistry"] | undefined,
	signal?: AbortSignal,
	timeoutMs = 3_000,
) {
	if (!registry) return [];
	const deadline = withTimeout(signal, timeoutMs);
	try {
		if (deadline.signal.aborted) throw deadline.signal.reason;
		const models = await awaitWithSignal(
			registry.getAvailableOfType("classifier", undefined, { signal: deadline.signal }),
			deadline.signal,
		);
		return models.map((model) => ({ provider: model.provider, id: model.id }));
	} catch {
		throw new ClassifierDiscoveryError(
			"Classifier discovery failed or stopped. Settings did not change. Use /web-search classifier provider/model to select a classifier directly.",
		);
	} finally {
		deadline.dispose();
	}
}
