# SEED: Bug reports from dog-fooding

- **Date**: 2026-03-07
- **From**: Jérémie Lumbroso.

---

## Brain Dump

While using our extension, I identified the following problems:
- Problem 1: Parsing for the Open Questions is not good
- Problem 2: Overly rigid QST parsing
- Problem 3: Overly rigid ADR numbering scheme?
- Problem 4: Current Open Questions flow doesn't provide context
- Problem 5: Seed listing is really necessary
- Problem 6: Off-by-one error with Open Questions dialog
- Problem 7: Issues with seed display in treeview



### Problem 1: Parsing for the Open Questions is not good

The parsing for the Open Questions panels is incomplete.

For instance, when the questions is:

```markdown
### QST: What exactly should /api/stats return in its minimal form?
- Status: unanswered
- Why asking: Need to decide what's exposed before before building. I propose:

  ```json
  {
    "server_name": "Penn MCP Server",
    "version": "0.1.0",
    "uptime_seconds": 3421,
    "require_login": false,
    "debug_mode": false,
    "storage_backend": "sqlite",
    "active_tokens": 4,
    "guest_tokens": 1,
    "authenticated_tokens": 3,
    "total_tool_calls": 142,
    "error_count": 2,
    "recent_calls": [
      {"tool": "me", "timestamp": "2026-03-03T14:22:01Z", "duration_ms": 3, "success": true},
      ...
    ]
  }
  ```

  `active_tokens` is a count only (no pennids). `recent_calls` has tool names and timing but no query content and no user identity unless `DEBUG_MODE=true`.
- Need: confirm this shape, or add/remove fields

**ANS:** (by Jérémie)
[Fill this in]
```

The panel will display:

```
Need to decide what's exposed before before building. I propose:
Need: confirm this shape, or add/remove fields
```

When the panel is:

```markdown
### QST: Should /api/stats require the ADMIN_PASSWORD, or be public?
- Status: unanswered
- Why asking: Two stances:

  1. **Protected** (requires `Authorization: Bearer <ADMIN_PASSWORD>`): More secure. But the stethoscope UI must know the password, which means the user has to configure it in the UI. GitHub Pages has no server-side secrets, so the password would be in the browser. That's fine for a debug tool (it's the same as Basic Auth on `/admin`) but worth noting.

  2. **Public** (no auth): Simpler. The data exposed (token counts, tool call names) is low-sensitivity. Anyone who knows the URL can see server health. This is the pattern used by many public status pages.

  My instinct: require `ADMIN_PASSWORD` if set, otherwise allow public access. If you set an admin password, the stethoscope UI prompts for it. If you don't set one (development), no auth needed.
- Need: preference

**ANS:** (by Jérémie)
[Fill this in]
```

The panel will display:

```
Two stances:
Need: preference
```

Obviously, it would be really nice if this were parsed really well and instead of alighting all of the context that it were displayed in some attractive way that separates, you know, or makes things visual or styles them well.

### Problem 2: Overly rigid QST parsing

When I added this to `docs/adr/0003-mcp-server-design.md`, to demonstrate the parsing of questions, it didn't work:

```markdown
---

### QST: Some Question?
- Status: unanswered
- Why asking: Claude Code scans for MCP servers registered in its settings. For the extension's MCP server to be available automatically, we need to either: (a) write to Claude Code's config automatically, or (b) give the user a command that does it, or (c) require manual config. This affects the "first run" experience and whether the collaboration loop is truly seamless.
- Need: preferred registration UX

**Option A — Extension auto-writes to Claude Code's MCP settings on activation**
- Registers `adr-server` in `~/.claude/settings.json` (or `.vscode/mcp.json` per workspace)
- Pros: fully seamless; zero friction; Claude Code sees it immediately
- Cons: writing to Claude's config without asking feels invasive; requires knowing the exact config format; may conflict with other entries

**Option B — Extension provides a "Register with Claude Code" command**
- User runs `ADR Manager: Register MCP Server` once; extension writes the config entry
- Pros: explicit user consent; one-time friction acceptable; still seamless after setup
- Cons: users need to know to run the command; first-run experience requires documentation

**Option C — Extension exposes HTTP on a predictable localhost port; user configures manually**
- Pros: any MCP client can connect (not just Claude Code)
- Cons: requires manual config; port conflicts possible; less seamless

**My recommendation**: Option B — the "Register with Claude Code" command is the right balance. It's explicit (user runs it once) but simple (one command). We can surface it in the welcome message on first activation. The extension could also detect if it's already registered and show a status in the sidebar.

**ANS:** (by Jérémie)
[ Fill this in  ]

---
```

Upon saving the file (as confirmed by version control preview), and refreshing the panel, no questions were detected, despite "unanswered". What was the issue?

Apparently, upon further testing, `[ Fill this in  ]` -> `[Fill this in]` was enough to make the parsing work.

It seems a bit not robust, not even to expect this specifically, but also with the spacing, or lack thereof.

[Note: I now removed this since I understood the issue so the ADR 0003 is no longer modified.]

**Important note:** As I'm dogfooding further, I'm realizing, there is some value to parsing this way: I was answering QST's manually (because of Problem 1 preventing me from really knowing what to answer), and I appreciated that as I answered the questions they disappeared from the sidebar as needing an answer, and are no longer in the Open Questions, despite the fact that I didn't properly trigger unanswered to answered. But I wonder if we can be a bit more robust perhaps?

### Problem 3: Overly rigid ADR numbering scheme?

I have a project that was created before certain things were formalized, and, I don't know the model decided to number on three digits:

```
.
├── 001-tech-stack-architecture.md
├── 002-output-formats-build-system.md
├── 003-data-model-yaml-structure.md
├── 004-penn-compliance-visual-design.md
├── 005-publications-management.md
├── 006-template-organization.md
├── 007-work-plan-implementation.md
├── 008-migrate-legacy-cv-data.md
├── 009-pdf-visual-review-mcp.md
├── 010-ci-cd-github-actions.md
├── 011-mcp-acp-tui-architecture.md
├── 012-pdf-review-dpi-strategy.md
├── 013-cv-data-verification-methodology.md
├── 014-per-semester-teaching-schema.md
├── 015-course-evaluation-schema-v2.md
├── 016-activity-report-conversion-pipeline.md
├── 017-linearized-mcp-output-format.md
├── 018-mcp-server-simon-hierarchy.md
├── 019-model-identity-principle.md
├── 020-bidirectional-tui-access.md
└── templates
    ├── collab-adr-lean.md
    ├── seed-template.md
    └── template.md

2 directories, 23 files
```

These are not recognized at all by the ADR. Maybe we should normalize for four digits for stable future addressing, and to allow refactoring, but also accept parsing on fewer digits if everything else checks out. Maybe just a warning that the official format is four digits? What would Herb Simon say?


### Problem 4: Current Open Questions flow doesn't provide context

Right now, the only way to read the context for answering the question, which is everything that's written before the questions, is to go in the ADR file. What I think would be really nice is if maybe below the buttons for accept and skip. Or maybe above if we can if we can create the collapsible box in a very fine vertical space. But it would be nice if there could be like a little collapsible box that says Click here for full context that's available for every question and that shows the same context for every question and that's the top part of the ADR So, that while you're answering questions, if you forgot what this is about, you can just open it up without having to go read the ADR.

### Problem 5: Seed listing is really necessary

Right seeds are third class citizens that are not well integrated at all. The changes suggested in:

`docs/adr/seed-2026-03-04-seeds-listing-in-the-adr-manager-treeview.md`

Are really timely!

### Problem 6: Off-by-one error with Open Questions dialog

This is anecdotal, but when I have clicked "Answer" on the second-to-last question, and I have moved forward to the next question by this process, I have experienced going back to the very first question in the deck, as though, there is a simultaneous +1 advancement that happens, without factoring that a question has been removed from the queue (the one just answered) so the modulo wraparound is changed.

## Problem 7: 

This was found by Claude Code Sonnet 4.6 (1M):

```
What I notice from the sidebar screencap: Seeds are showing as ADR-0000: — that's still a display bug (the tree label code uses extractAdrNumber which returns 0 for seed- files). The creation bug is fixed, but the display/indexing of existing seeds still needs work. That's a bug-fix-context task.
```

That was before Sonnet 4.6 (1M) thought they had addressed this problem:

```
Bug fixed: seeds now create seed-2026-03-05-topic.md instead of 0009-topic.md. The ADR number slot is no longer burned by seed creation.
```


When given this screencap:
```
ADRS FOR Al: ADR E... 7 + • G 日
- 19 open questions
O ADR-0000: SEED: Bug reports fro... M
O ADR-0000: SEED: Potential Forma 5: ...
O ADR-0000: SEED: Enforcing ADR For...
ADR-0001: Project Specifications - V...
• ADR-0002: Parser Architecture [Partial...
当 ADR-0003: MCP Server Design [Partia...
? Should the MCP transport be HTTP...
? Should seeds be a separate tool na...
? What does Phase 4 (Al features) ne...
? Does Forma 3 need SQLite, or can ...
? How should the Forma 5 portability ...
? Should ADR-0003 own the full tool ...
? What is the complete syntax for AD...
? How should the "Decision by Fiat"
? For the seed-on-seeds insights - h...
? The seed's iterative discussion prot...
ADR-0004: Ul Paradigm [Draft]
• ADR-0005: CLAUDE.md Parser and Di...
V ADR-0006: Brand Color - Amber [Acc...
ADR-0007: Single Source of Truth for ...
V ADR-0008: ADR Deep Link Protocol [...
? What is the canonical local referenc...
? What is the canonical global refere...
? How should version annotations wo...
? Should seeds get their own referen...
V ADR-0009: Decision Resolution Taxon...
? What are the correct resolution typ...
? Where in the ADR header does the ...
? How does "Decision by Fiat" intera...
? Should the MCP 'update_resolutio...
? Should the ADR format support "for...
```

and here was part of the thinking trace:

```
I'm also noticing the sidebar is still showing seeds as "ADR-0000" even though we fixed the filename generation. The tree view is pulling a 0 from extractAdrNumber() and treating them like regular ADRs instead of recognizing the isSeed flag. The display needs to either hide these seeds from the tree or show them with a different label that reflects their actual purpose.

I'm tracing through the file watching logic now—the watcher monitors docs/adr/*.md and calls isAdrFile() on changes, which we fixed to skip seed- prefixed files. But the initial workspace indexing might be picking them up differently, so I need to check how reindexWorkspace handles the seed files. I'm realizing the seed files must be getting indexed somehow despite the regex filter. Looking at the actual filenames in the screenshot, I see entries like 0012-output-format-for-llm-consu and 0013-field-projection-for-token-eff which do match the ^\d{4} pattern, so those would be picked up by the filter—but the "ADR-0000: SEED" entries suggest seed files are also appearing in the results, which shouldn't happen based on the current filtering logic. in the sidebar. Wait no, those are separate files in the research folder.

Actually looking at the sidebar again, I see several ADR entries that all start with ADR-0000 and have SEED: in their titles. If these are seed-YYYY-MM-DD-*.md files, they shouldn't match the ^\d{4} pattern. But maybe there are still some files using the old 0008-seed-* naming convention from before the bug was fixed? Jérémie mentioned renaming one, but there could be others lingering.

Looking at the git history, before the fix Jérémie created a file that was later moved from 0008-seeds-listing-in-the-adr-manager-treeview.md to seed-2026-03-04-seeds-listing-in-the-adr-manager-treeview.md. So there might not be any remaining 0008-* files. The isSeed parsing checks the title for # SEED: ..., and when a file starts with seed-YYYY-MM-DD, extractAdrNumber returns 0.

Wait, I think I found it. The indexDirectory function explicitly filters files with /^\d{4}[-_]/ to exclude seed files, so they shouldn't appear in the index at all. But they're showing up in the screenshot, which means either the filter isn't working or there's something else going on. I'm realizing the fixture-workspace likely contains ADR files with numeric prefixes like 0001-, 0002-, etc. that are being picked up by the extension, and some of these might be leftover seed files from Jérémie's earlier testing before the filtering was fixed.
```

---

**Model**: Please chunk this into ADRs using [`template-with-human-ai-collaboration.md`](template-with-human-ai-collaboration.md)



