# pi-jujutsu

Live working copy status and repo context for [jj](https://jj-vcs.dev/) repos
in [pi](https://pi.dev).

## Install

```bash
pi install git:github.com/956MB/pi-jujutsu
```

Or in `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/956MB/pi-jujutsu"]
}
```

## Configuration

All options are optional; the defaults reproduce upstream behavior.

```json
{
  "piJujutsu": {
    "showWidgetOnStart": true
  }
}
```

| Option               | Default | Description                                                                                       |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `showWidgetOnStart`  | `true`  | Show the working copy widget when a session starts. Set to `false` to start hidden — `Ctrl+Shift+J` still toggles it on demand. The footer label is unaffected. |

Settings live in the global pi settings file (`~/.pi/agent/settings.json`,
or `$PI_CODING_AGENT_DIR/settings.json`). They are re-read on session start,
so a change applies the next time you open pi — no restart of the extension
or rebuild needed.

## What it does

### Footer

In jj colocated repos, pi's footer normally shows `(detached)` because git
sees a detached HEAD. pi-jujutsu replaces this with useful context:

- **Bookmark name** if `@` has one: `(main)`
- **Commit description** otherwise: `(add login endpoint)`
- **Shortest unique change ID** as fallback: `(v)`
- **Stack depth** when working on a stack: `(add login [3])`
- **Empty prefix** when `@` has no changes: `(empty: main)`

### Working copy widget

A colored widget above the editor shows the current working copy diff stat
(`@` vs `@-`), with green/red for insertions and deletions:

```
 src/index.ts  | 48 +++++++++++++++++++++++++++++++++++++-----------
 src/config.ts | 12 ++++++++++++
 2 files (+49, -11)
```

When `@` is empty (e.g. right after `jj commit`), the widget collapses
to a one-liner showing the parent commit:

```
 @- add login endpoint · 2 files (+49, -11)
```

The widget updates live between agent turns and stays visible after the
agent finishes. It also appears on session start if the working copy has
uncommitted changes — unless `showWidgetOnStart` is `false`. Stat bars adapt
to terminal width on resize.

Changes from other terminals (e.g. running `jj commit` elsewhere) are
detected automatically and the widget and footer update within moments.

Toggle the widget with `Ctrl+Shift+J`. The widget is display-only;
nothing is sent to the LLM.

## Requirements

- [jj](https://jj-vcs.dev/) installed and on PATH
- A jj repository (colocated or standalone)

The extension silently does nothing in non-jj repos.

## Development

```bash
npm install
npm run build     # tsup -> dist/ (commit dist/ before pushing)
npm test          # vitest
npm run typecheck # tsc --noEmit
```

pi installs git packages with `npm install --omit=dev --omit=peer`, so there is
no build step at install time. **`dist/` must be committed.**

## Credit

This is a copy of the `pi-jujutsu` package from
[mgabor3141/yapp](https://github.com/mgabor3141/yapp) — a larger monorepo of
several pi extensions. Only the `packages/jujutsu` package was taken; the other
packages in that repo were not needed here, so the whole monorepo was not
cloned. Local change: the `showWidgetOnStart` config option. All original work
and the design are by mgabor; MIT licensed, see [LICENSE](./LICENSE).
