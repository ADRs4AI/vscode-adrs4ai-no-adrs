# ADR 0003: Widget Rendering Strategy

- **Date**: 2026-03-16
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso, Claude Sonnet 4.6

---

## Context

When rendering widgets, use client-side JS or server-side HTML?

---

## Decision: Server-side rendering

Chosen because it works without JavaScript and is easier to cache.

---

## Open Questions

<!-- Deviation D1: "## Open Questions" instead of "## Questions" -->

### QST: Should we support client-side hydration for interactive widgets?

<!-- Deviation D2: bold Status field: "- **Status**: ..." instead of "- Status: ..." -->
<!-- Deviation D3: bold Why asking field -->
- **Status**: unanswered
- **Why asking**: Some widgets (date pickers, sliders) need client-side interactivity. SSR-only blocks these use cases.
- **Need**: Decision on whether hydration is in scope for v1.

<!-- Deviation D4: "**ANS:** (fill in)" instead of "**ANS:** (by Human)\n\n[Fill this in]" -->
**ANS:** (fill in)

---

### QST: Should the widget registry be static (compile-time) or dynamic (runtime)?

- **Status**: unanswered
- **Why asking**: A static registry is simpler but requires a rebuild to add new widgets. A dynamic registry allows plugin-style extension.
- **Options**:
  1. Static registry — simpler, faster, no runtime surprises
  2. Dynamic registry — extensible, but requires a plugin API

**ANS:** (fill in)
