// src/index.ts
import { watch } from "fs";
import { join as join2 } from "path";

// src/config.ts
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var CONFIG_KEY = "piJujutsu";
var DEFAULT_CONFIG = {
  showWidgetOnStart: true
};
function getAgentDir() {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (override) {
    return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
  }
  return join(homedir(), ".pi", "agent");
}
function getSettingsPath() {
  return join(getAgentDir(), "settings.json");
}
function loadConfig(settingsPath = getSettingsPath()) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
  const block = parsed[CONFIG_KEY];
  if (!block || typeof block !== "object") return { ...DEFAULT_CONFIG };
  const value = block.showWidgetOnStart;
  return {
    showWidgetOnStart: typeof value === "boolean" ? value : DEFAULT_CONFIG.showWidgetOnStart
  };
}

// src/format.ts
var ANSI_RE = /\x1b\[[0-9;]*m/g;
function visibleLen(s) {
  return s.replace(ANSI_RE, "").length;
}
function truncate(s, maxWidth) {
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < maxWidth) {
    if (s[i] === "\x1B") {
      const end = s.indexOf("m", i);
      i = end === -1 ? s.length : end + 1;
    } else {
      visible++;
      i++;
    }
  }
  return `${s.slice(0, i)}\x1B[0m`;
}
function colorizeFileLine(line, theme) {
  const pipeIdx = line.lastIndexOf("|");
  if (pipeIdx === -1) return line;
  const prefix = line.slice(0, pipeIdx + 1);
  const bar = line.slice(pipeIdx + 1);
  const coloredBar = bar.replace(/([+]+)/g, (m) => theme.fg("toolDiffAdded", m)).replace(/([-]+)/g, (m) => theme.fg("toolDiffRemoved", m));
  return prefix + coloredBar;
}
var SUMMARY_RE = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;
function formatStats(summaryLine, theme) {
  const match = summaryLine.match(SUMMARY_RE);
  if (!match) return null;
  const files = match[1];
  const ins = match[2] ? Number.parseInt(match[2], 10) : 0;
  const del = match[3] ? Number.parseInt(match[3], 10) : 0;
  const parts = [];
  if (ins > 0) parts.push(theme.fg("toolDiffAdded", `+${ins}`));
  if (del > 0) parts.push(theme.fg("toolDiffRemoved", `-${del}`));
  const counts = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${files} file${files === "1" ? "" : "s"}${counts}`;
}
function formatSummaryLine(line, theme) {
  return formatStats(line, theme) ?? line;
}
var MAX_FILE_LINES = 8;
function buildWidgetLines(wc, theme) {
  const lines = [];
  if (wc.fileLines.length <= MAX_FILE_LINES) {
    for (const fl of wc.fileLines) lines.push(colorizeFileLine(fl, theme));
  } else {
    for (const fl of wc.fileLines.slice(0, MAX_FILE_LINES - 1)) lines.push(colorizeFileLine(fl, theme));
    const hidden = wc.fileLines.length - (MAX_FILE_LINES - 1);
    lines.push(theme.fg("muted", `  ... and ${hidden} more file${hidden === 1 ? "" : "s"}`));
  }
  lines.push(formatSummaryLine(wc.summaryLine, theme));
  return lines;
}
function formatParentOneLiner(description, summaryLine, theme) {
  const stats = formatStats(summaryLine, theme);
  const prefix = theme.fg("accent", "@-");
  const sep = stats ? theme.fg("muted", " \xB7 ") : "";
  return `${prefix} ${description}${sep}${stats ?? ""}`;
}
function labelFor(info) {
  if (info.bookmarks.length > 0) return info.bookmarks[0];
  if (info.description) return info.description;
  return info.changeShort;
}

// src/index.ts
function index_default(pi) {
  let isJjRepo = false;
  let branchLabel = null;
  let patched = false;
  let jjRoot = null;
  let agentActive = false;
  let widgetVisible = loadConfig().showWidgetOnStart;
  let lastWidgetCtx = null;
  let opWatcher = null;
  let debounceTimer = null;
  async function detectJj() {
    const result = await pi.exec("jj", ["root"], { timeout: 3e3 });
    isJjRepo = result.code === 0;
    jjRoot = isJjRepo ? result.stdout.trim() : null;
  }
  async function queryRev(rev) {
    const result = await pi.exec(
      "jj",
      [
        "--ignore-working-copy",
        "log",
        "--no-graph",
        "-r",
        rev,
        "-T",
        'if(empty, "E", "M") ++ "\\n" ++ description.first_line() ++ "\\n" ++ bookmarks.join(",") ++ "\\n" ++ change_id.shortest()'
      ],
      { timeout: 3e3 }
    );
    if (result.code !== 0) return null;
    const lines = result.stdout.split("\n");
    return {
      empty: lines[0] === "E",
      description: lines[1] ?? "",
      bookmarks: (lines[2] ?? "").split(",").filter(Boolean),
      changeShort: lines[3] ?? ""
    };
  }
  async function getStackDepth() {
    const result = await pi.exec(
      "jj",
      ["--ignore-working-copy", "log", "--no-graph", "-r", "::@ & mutable()", "-T", "'.'\n"],
      { timeout: 3e3 }
    );
    if (result.code !== 0) return 0;
    return result.stdout.split("\n").filter(Boolean).length;
  }
  async function snapshot() {
    const result = await pi.exec("jj", ["util", "snapshot"], { timeout: 1e4 });
    if (result.code === 0) return { ok: true };
    return { ok: false, error: (result.stderr || result.stdout).trim() };
  }
  async function getDiffStat(rev, columns) {
    const jjArgs = rev ? ["diff", "-r", rev, "--stat"] : ["diff", "--stat"];
    const cmd = columns ? "env" : "jj";
    const args = columns ? [`COLUMNS=${columns}`, "jj", ...jjArgs] : jjArgs;
    const result = await pi.exec(cmd, args, { timeout: 1e4 });
    if (result.code !== 0) return null;
    const lines = result.stdout.split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    const summaryLine = lines[lines.length - 1];
    if (!summaryLine.match(/\d+ files? changed/)) return null;
    return {
      fileLines: lines.slice(0, -1),
      summaryLine
    };
  }
  async function refreshLabel() {
    if (!isJjRepo) {
      branchLabel = null;
      return;
    }
    try {
      const at = await queryRev("@");
      if (!at) {
        branchLabel = null;
        return;
      }
      const label = labelFor(at);
      const depth = await getStackDepth();
      const base = depth > 1 ? `${label} [${depth}]` : label;
      branchLabel = at.empty ? `empty: ${base}` : base;
    } catch {
      branchLabel = null;
    }
  }
  function patchFooter(ctx) {
    if (!ctx.hasUI || patched) return;
    ctx.ui.setFooter((_tui, _theme, footerData) => {
      const original = footerData.getGitBranch.bind(footerData);
      footerData.getGitBranch = () => {
        const branch = original();
        return branch === "detached" && branchLabel ? branchLabel : branch;
      };
      patched = true;
      return { render: () => [], dispose() {
      } };
    });
    ctx.ui.setFooter(void 0);
  }
  const WIDGET_KEY = "jj-diff";
  const WIDGET_PADDING = 1;
  function showWidget(ctx, wc, rev) {
    lastWidgetCtx = ctx;
    if (!ctx.hasUI || !widgetVisible) return;
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
      let lines = buildWidgetLines(wc, theme);
      let renderedWidth = 0;
      let refreshing = false;
      return {
        render(width) {
          if (renderedWidth && renderedWidth !== width && !refreshing) {
            refreshing = true;
            getDiffStat(rev, width - WIDGET_PADDING).then((newWc) => {
              if (newWc) {
                lines = buildWidgetLines(newWc, theme);
              }
              renderedWidth = width;
              refreshing = false;
              showWidget(ctx, newWc ?? wc, rev);
            }).catch(() => {
              refreshing = false;
            });
          }
          renderedWidth = width;
          return lines.map((l) => {
            const padded = ` ${l}`;
            return visibleLen(padded) > width ? truncate(padded, width) : padded;
          });
        },
        invalidate() {
        }
      };
    });
  }
  function showOneLiner(ctx, description, summaryLine) {
    lastWidgetCtx = ctx;
    if (!ctx.hasUI || !widgetVisible) return;
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
      const line = formatParentOneLiner(description, summaryLine, theme);
      return {
        render(width) {
          const padded = ` ${line}`;
          return [visibleLen(padded) > width ? truncate(padded, width) : padded];
        },
        invalidate() {
        }
      };
    });
  }
  function clearWidget(ctx) {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(WIDGET_KEY, void 0);
  }
  async function snapshotAndRefreshWidget(ctx) {
    if (!isJjRepo) return;
    const { ok, error } = await snapshot();
    if (!ok) {
      if (ctx.hasUI) {
        const firstLine = error?.split("\n")[0] || "";
        const msg = firstLine ? `pi-jujutsu: snapshot failed: ${firstLine}` : "pi-jujutsu: snapshot failed";
        ctx.ui.notify(msg, "error");
      }
      return;
    }
    await refreshWidget(ctx);
  }
  async function refreshWidget(ctx) {
    if (!isJjRepo) return;
    const wc = await getDiffStat();
    if (wc) {
      showWidget(ctx, wc);
      return;
    }
    const parent = await queryRev("@-");
    const parentStat = await getDiffStat("@-");
    if (parent && parentStat) {
      const desc = parent.description || parent.changeShort;
      showOneLiner(ctx, desc, parentStat.summaryLine);
      return;
    }
    clearWidget(ctx);
  }
  function stopWatcher() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (opWatcher) {
      opWatcher.close();
      opWatcher = null;
    }
  }
  function startWatcher(ctx) {
    stopWatcher();
    if (!jjRoot) return;
    const opHeadsDir = join2(jjRoot, ".jj", "repo", "op_heads", "heads");
    try {
      opWatcher = watch(opHeadsDir, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          debounceTimer = null;
          if (agentActive) return;
          await refreshLabel();
          patchFooter(ctx);
          await refreshWidget(ctx);
        }, 200);
      });
      opWatcher.unref();
    } catch {
      opWatcher = null;
    }
  }
  function reloadConfig() {
    widgetVisible = loadConfig().showWidgetOnStart;
  }
  pi.on("session_start", async (_event, ctx) => {
    reloadConfig();
    await detectJj();
    if (!isJjRepo) return;
    await refreshLabel();
    patchFooter(ctx);
    await snapshotAndRefreshWidget(ctx);
    startWatcher(ctx);
  });
  pi.on("session_switch", async (_event, ctx) => {
    stopWatcher();
    patched = false;
    reloadConfig();
    await detectJj();
    if (!isJjRepo) return;
    await refreshLabel();
    patchFooter(ctx);
    await snapshotAndRefreshWidget(ctx);
    startWatcher(ctx);
  });
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!isJjRepo) return;
    agentActive = true;
  });
  pi.on("turn_end", async (_event, ctx) => {
    if (!isJjRepo) return;
    await snapshotAndRefreshWidget(ctx);
  });
  pi.on("agent_end", async (_event, ctx) => {
    if (!isJjRepo) return;
    agentActive = false;
    await snapshotAndRefreshWidget(ctx);
    await refreshLabel();
    patchFooter(ctx);
  });
  pi.registerShortcut("ctrl+shift+j", {
    description: "Toggle jj working copy widget",
    handler: async (ctx) => {
      widgetVisible = !widgetVisible;
      if (widgetVisible) {
        await refreshWidget(lastWidgetCtx ?? ctx);
      } else {
        clearWidget(ctx);
      }
    }
  });
}
export {
  index_default as default
};
