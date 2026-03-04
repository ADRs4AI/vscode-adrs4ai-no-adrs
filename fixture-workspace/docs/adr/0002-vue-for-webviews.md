# ADR-0002: Use Vue 3 for Webview Panels

- **Date**: 2026-03-03
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso, Sonnet 4.6 (1M)

---

## Quick Reference

**Navigation codes** (for grep):
- `QST:` Questions
- `ANS:` Answers
- `NOT:` Notes

---

## Questions

### QST: Vue 3 SFC or vanilla TypeScript for webviews?
- Status: unanswered
- Why asking: Webviews are sandboxed iframes. Vue adds reactivity nicely but means bundling Vue into the webview. Vanilla TS is lighter but more manual DOM work for the open questions panel.
- Need: pick one with reasoning

**ANS:** (by Jérémie)
[Fill this in]

---

### QST: Should the webview and extension share TypeScript types?
- Status: unanswered
- Why asking: The open questions panel needs the Question type. We could share types via a common package or just duplicate the interface. Monorepo patterns add complexity.
- Need: yes/no

**ANS:** (by Jérémie)
[Fill this in]

---

## Decision

### Context
[Pending QST answers]

### Chosen: [TBD]

---

## Iterations

### Iteration 1 (2026-03-03)
- Human: Decision deferred from ADR-0004 (UI Paradigm)
- AI (Sonnet 4.6): Created this ADR with 2 open QSTs
- Outcome: Draft, awaiting answers
