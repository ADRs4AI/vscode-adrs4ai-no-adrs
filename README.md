# ADRs for AI

*A VS Code extension that keeps your AI's reasoning from evaporating when the chat closes.*

---

## Your Tuesday, with this installed

You ask an AI model to help design something — auth, a schema, an API shape. It asks good questions, you argue a little, you land somewhere. Two weeks later you (or a different AI session, or a teammate) open the same file and none of that conversation is there anymore. Just the code, with no record of what you tried instead, or why.

This extension makes the *decision* — not just the code — a durable, browseable thing inside your editor. Open questions live in a sidebar you can answer without hunting through chat history. Answers are captured the moment you type them, so a file refresh or an agent editing nearby never costs you a half-written thought. Every decision keeps its own history of how it changed and why.

It's built for a specific document format ([`collab-adr-lean`](https://github.com/jlumbroso/human-ai-collaboration-template-A)) — Architectural Decision Records extended with a few navigation codes (`QST:`, `ANS:`, `NOT:`) so both you and any AI model can grep straight to what's unresolved. You don't need to memorize the format; the extension reads and writes it for you.

## Why you'd want it

- **Nothing gets buried.** Every open question, across every decision in your project, shows up in one panel — sorted, counted, one click from "unresolved" to "answered."
- **Your answers can't be lost.** Type an answer, and it's saved as you type — even if the file changes underneath you mid-answer (an AI agent editing the same file, a git pull, a reindex), your draft survives and reloads where you left off. This isn't a hopeful claim: it's a regression test we run against the exact incident that used to destroy people's answers — see [`DEBRIEF-001`](docs/adr/DEBRIEF-001-panel-answer-loss-agent-rewrite.md), which is also the honest record of how we found the bug.
- **Nobody has to remember the format.** The sidebar tree shows status at a glance (draft, accepted, superseded); the panel handles the QST/ANS bookkeeping; plain Markdown files without any of the extra structure still show up and work, just with fewer bells.
- **It's yours, not a walled garden.** Everything lives in Markdown files in your repo (`docs/adr/` by default). Delete the extension tomorrow and you still have readable documents — no lock-in, no proprietary database.

## What you install

1. Install **ADRs for AI** from the VS Code Marketplace (search "ADRs for AI", or `ext install jlumbroso.adrs-for-ai`).
2. Open a project that has a `docs/adr/` folder with at least one Markdown file in it. (Don't have one yet? The extension can scaffold your first ADR — see below.)

That's it — there's no server to run, no account, no API key required. (An Anthropic API key is optional and only unlocks AI-assisted extras; everything above works without one.)

If you're starting from nothing, pair this with the [companion template](https://github.com/jlumbroso/human-ai-collaboration-template-A) — a set of starter files (`CLAUDE.md`, ADR templates, a short methodology doc) that gives an AI model the vocabulary this extension expects.

## Your first ten minutes

1. **Open a project** with a `docs/adr/` folder. The **ADRs for AI** icon appears in the Activity Bar automatically — no setup step.
2. **Click it.** You'll see every ADR in your project, its status (draft / accepted / superseded), and how many open questions it has.
3. **Click "Answer Open Questions"** (or the badge count) to open the live panel — every unresolved `QST:` across your whole project, one at a time, with an answer box right there.
4. **Type an answer, `Cmd+Enter` to submit.** Watch for the small "draft saved" line while you type — that's the anti-clobbering fence working, not a feature you need to think about.
5. **Set your name once** (`adrManager.humanName` in Settings, or it'll fall back to your git `user.name`) so it pre-fills who's answering.

That's the whole loop. Everything else — deep links between ADRs, creating new ones, filtering by status, committing only your ADR changes — is discoverable from the sidebar's toolbar and right-click menu when you're ready for it.

## Where to go when it surprises you

- **Something looks wrong or a file didn't update** — right-click the sidebar and hit Refresh; the extension re-scans on save automatically, so this is rarely needed.
- **A question you answered still shows as open** — check that you hit `Cmd+Enter` or the Answer button rather than just clicking away; the status bar (bottom right) shows the extension's version if you suspect a stale build.
- **Something actually breaks** — [open an issue](https://github.com/jlumbroso/vscode-adrs-for-ai/issues). We keep a public, ADR-formatted debrief for every incident that costs a user real work (again: [`DEBRIEF-001`](docs/adr/DEBRIEF-001-panel-answer-loss-agent-rewrite.md) is one), because a project whose whole pitch is "honest record-keeping" doesn't get to hide its own.

## Reference

### Features

| Feature | What it does |
|---|---|
| ADR Explorer (sidebar) | Browse every ADR, live status badges, open-question counts |
| Open Questions panel | Answer unresolved questions from any ADR, in place, without opening the file |
| Draft persistence | In-progress answers auto-save and survive file changes, reindexes, and crashes |
| Seeds | Brain-dump files that get chunked into ADRs — first-class in the tree, not just plain files |
| Deep links | Stable links to a specific ADR section (`adr:0012#some-heading`), for referencing decisions from code or other ADRs |
| ADR Commit | Stage and commit only your ADR changes, stash everything else, restore it after |
| Format tolerance | Works with `collab-adr-lean` (QST/ANS/NOT navigation codes) and plain MADR files side by side |

### Key settings

| Setting | Default | What it's for |
|---|---|---|
| `adrManager.adrDirectory` | `docs/adr` | Where your ADRs live, relative to the workspace root |
| `adrManager.humanName` | *(git user.name)* | Pre-fills "Deciders" and "Answering as" fields |
| `adrManager.aiModel` | `Sonnet 4.6 (1M)` | AI model name used in new ADR templates |
| `adrManager.clickNavigatesTo` | `question` | Jump to the question heading or straight to the answer field |

All settings and commands are also browsable via the Command Palette (`ADR Manager: ...`) and the Settings UI (search "ADR").

## Related

- [`human-ai-collaboration-template-A`](https://github.com/jlumbroso/human-ai-collaboration-template-A) — the ADR framework and starter files this extension is built for
- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — the fuller reasoning behind the format, for anyone who wants the "why," not just the "how"
