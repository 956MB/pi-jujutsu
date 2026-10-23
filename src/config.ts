import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Key under which this extension reads its settings in
 * `~/.pi/agent/settings.json`.
 */
export const CONFIG_KEY = "piJujutsu";

export interface JjConfig {
	/**
	 * Start each session with the working copy widget visible.
	 *
	 * `true` (default): the widget appears on session start when the working
	 * copy has changes, exactly like upstream pi-jujutsu.
	 * `false`: the widget stays hidden on session start; toggle it at any time
	 * with `Ctrl+Shift+J`.
	 *
	 * The footer label is unaffected by this option.
	 */
	showWidgetOnStart: boolean;
}

export const DEFAULT_CONFIG: JjConfig = {
	showWidgetOnStart: true,
};

/** Mirrors pi's own agent dir resolution (`PI_CODING_AGENT_DIR` override). */
export function getAgentDir(): string {
	const override = process.env.PI_CODING_AGENT_DIR;
	if (override) {
		return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
	}
	return join(homedir(), ".pi", "agent");
}

export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/**
 * Reads the `piJujutsu` block from the global pi settings file.
 *
 * Missing file, invalid JSON, or malformed values all fall back to
 * `DEFAULT_CONFIG` — a bad config never breaks the extension.
 */
export function loadConfig(settingsPath: string = getSettingsPath()): JjConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch {
		return { ...DEFAULT_CONFIG };
	}

	if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };

	const block = (parsed as Record<string, unknown>)[CONFIG_KEY];
	if (!block || typeof block !== "object") return { ...DEFAULT_CONFIG };

	const value = (block as Record<string, unknown>).showWidgetOnStart;
	return {
		showWidgetOnStart: typeof value === "boolean" ? value : DEFAULT_CONFIG.showWidgetOnStart,
	};
}
