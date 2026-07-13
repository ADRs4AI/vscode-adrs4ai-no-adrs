# ADR 0014: LLM Gallery for Agent Experience

- **Date**: 2026-06-15
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

---

## Open Questions

<!-- Deviation: the question is bold inline body text, not a Markdown heading of
     any level — a heading-node-based parser never sees it. The "answer" is
     delivered via "**NOT**:", which this project's own template defines as the
     NOT: navigation code (a note/observation), not an answer/recommendation
     marker — so even a parser that found the bold QST text has no recognizable
     answer field to pair it with. -->
**QST: Numbering style**

Options:
1. Position-only: `(2,3)` references in metadata, no overlay
2. Sequential numbering: `#1`, `#2`, ... overlaid on images
3. Both: numbered overlay + position in metadata

**NOT**: Position-only is cleanest (no image modification), but numbering overlay may be more intuitive for humans. Make it configurable (default: off).
