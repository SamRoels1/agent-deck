# agent-deck

A dashboard for [Claude Code](https://claude.com/claude-code), written as a Claude Code *mod*. It opens a pane next to your conversation that shows what your agents are doing, and it quietly sends simple subagent tasks to cheaper models.

It is a derivative of [Flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella (MIT), extended with the parts below.

## What you get

- **Agents**: a card or lane per subagent with its model, difficulty level, a progress bar and a run counter when a task repeats.
- **Model routing**: when Claude starts a subagent, a small Haiku call rates the task as simple, moderate or complex. Simple goes to Haiku, moderate to Sonnet, complex stays on your session model. A scoreboard shows the split per model, plus all-time totals.
- **Todo list**: shared between you and your agents. Add items in the pane or with `/todo add <title>`, or let a planner agent split a goal with `/todo plan <goal>`. Agents claim items, report progress and check them off.
- **Activity**: your prompts, agent events and errors, newest first, five at a time with an expand arrow. Pressing a line scrolls the chat to it where the surface allows.
- **Git**: branch, ahead/behind and changed-file counts, using read-only `git status`.
- **Second brain**: note counts and recently touched notes of an Obsidian vault.
- **Toasts**: a notification when an agent finishes, a permission is denied, or context or a rate limit gets close to full.
- Every box has an arrow that folds it, and a button above the prompt opens the pane.

Commands: `/deck` (open, `close`, `reset`, `vault`, `layout auto|compact|wide|mini`) and `/todo` (`add`, `done`, `open`, `rm`, `clear`, `list`, `plan`).

## Install

You need Claude Code 2.1.287 or newer (2.1.286 for the desktop app). Run these in a terminal; a mod installed at user scope also loads in the desktop app's Code tab.

```bash
claude plugin marketplace add SamRoels1/agent-deck
claude plugin install agent-deck@agent-deck --scope user
```

Restart Claude Code, or run `/reload-plugins` in a session. Then type `/deck`.

## Update

```bash
claude plugin marketplace update agent-deck
claude plugin update agent-deck@agent-deck
```

Restart Claude Code to apply. An update is picked up when `version` in `.claude-plugin/plugin.json` changes, so bump it for every release.

## Settings

The one setting you probably want is the vault folder for the second brain box:

```bash
claude plugin configure agent-deck
```

Set `vaultPath` to your Obsidian vault, for example `C:/Users/you/Documents/Vault`. Left empty, the box only shows a hint. Other settings (layout, palette, which panels show, whether the pane opens on start) are listed by the same command.

## What it can do on your machine

Mods run with your permissions and are not sandboxed, so read this before installing. `claude plugin validate <folder>` lists the same facts from the source.

- Reads the folder you set as `vaultPath` (file names and modification times only, no contents).
- Runs `git status --porcelain=v2 --branch` in your session folder.
- Makes one small Haiku call per subagent start to rate the task.
- Registers three tools (`todo_add`, `todo_update`, `todo_list`) and one agent type (`agent-deck:planner`), and adds the open todos to each subagent's prompt.
- Keeps the todo list and routing totals in Claude Code's own store. It makes no network requests of its own.

To switch mods off: `claude --safe-mode` for one session, or disable it in the Installed tab of `/plugin`.

## Develop

Clone the repo and load it straight from the folder instead of installing:

```bash
claude --plugin-dir /path/to/agent-deck
```

Notes from building this (the engine enforces them):

- `$` can only be passed to functions declared in the same file. State atoms must be defined in the file that reads them.
- Only one unmatched `on('event')` per event across the whole mod, so extra hooks use always-true matchers such as `{ turnId: /^/ }`.
- `claude plugin validate .` is the check; there is no type-check step in this repo yet.

## License

MIT. See [LICENSE](LICENSE). Flightdeck's copyright notice is kept as the license requires.
