# ADRs for AI

A VS Code extension for navigating and managing Architectural Decision Records (ADRs) using the [`collab-adr-lean`](https://github.com/jlumbroso/human-ai-collaboration-template-v1) format — designed for human-AI collaboration.

## Features

- **ADR Explorer** — Browse all ADRs in the sidebar with live status badges and open question counts
- **Open Questions Panel** — Answer unanswered questions from all ADRs in one focused panel, without opening individual files
- **Live Updates** — File watcher keeps the index fresh as you edit and save
- **Smart Navigation** — Right-click to change status, copy deep links, jump to answer fields
- **ADR Commit** — Stage and commit only ADR changes (stash → commit → restore)
- **New ADR / New Seed** — Create full collab-adr-lean ADRs or brain-dump seeds from the sidebar
- **Filter** — Toggle sidebar questions between open, all, and answered views

## Getting Started

1. Open a project containing `docs/adr/*.md` files
2. The **ADR Explorer** appears automatically in the Activity Bar
3. Set your name once: `adrManager.humanName` in VS Code settings

## Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `adrManager.humanName` | `""` | Your name — pre-fills new ADRs and the answering panel |
| `adrManager.aiModel` | `"Sonnet 4.6 (1M)"` | AI model name for new ADR templates |
| `adrManager.adrDirectory` | `"docs/adr"` | ADR directory, relative to workspace root |
| `adrManager.clickNavigatesTo` | `"question"` | When navigating to a question: jump to heading or answer field |

## ADR Format

This extension is built for the [collab-adr-lean](https://github.com/jlumbroso/human-ai-collaboration-template-v1) format — an extended MADR format with navigation codes (`QST:`, `ANS:`, `NOT:`, etc.) and iteration tracking for human-AI collaboration. Standard MADR files are also supported with graceful degradation.

## Related

- [human-ai-collaboration-template-v1](https://github.com/jlumbroso/human-ai-collaboration-template-v1) — the ADR framework this extension is built for
