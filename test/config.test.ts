import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

function settingsFile(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-jujutsu-"));
	const path = join(dir, "settings.json");
	writeFileSync(path, contents);
	return path;
}

describe("loadConfig", () => {
	it("defaults to showing the widget", () => {
		expect(DEFAULT_CONFIG.showWidgetOnStart).toBe(true);
		expect(loadConfig(join(tmpdir(), "pi-jujutsu-does-not-exist.json"))).toEqual({ showWidgetOnStart: true });
	});

	it("reads showWidgetOnStart: false", () => {
		const path = settingsFile(JSON.stringify({ piJujutsu: { showWidgetOnStart: false } }));
		expect(loadConfig(path).showWidgetOnStart).toBe(false);
	});

	it("reads showWidgetOnStart: true", () => {
		const path = settingsFile(JSON.stringify({ piJujutsu: { showWidgetOnStart: true } }));
		expect(loadConfig(path).showWidgetOnStart).toBe(true);
	});

	it("ignores non-boolean values", () => {
		const path = settingsFile(JSON.stringify({ piJujutsu: { showWidgetOnStart: "no" } }));
		expect(loadConfig(path).showWidgetOnStart).toBe(true);
	});

	it("survives invalid JSON and unrelated keys", () => {
		expect(loadConfig(settingsFile("{ not json")).showWidgetOnStart).toBe(true);
		expect(loadConfig(settingsFile(JSON.stringify({ theme: "kanso" }))).showWidgetOnStart).toBe(true);
		expect(loadConfig(settingsFile(JSON.stringify({ piJujutsu: {} }))).showWidgetOnStart).toBe(true);
	});
});
