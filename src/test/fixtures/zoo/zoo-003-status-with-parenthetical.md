# ADR 0005: Deployment Strategy

- **Date**: 2026-03-16
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso, Claude Sonnet 4.6

---

## Context

Where and how do we deploy the application?

---

## Open Questions

### QST: Should we auto-commit deployment artifacts?

<!-- Deviation D2b: status has trailing parenthetical commentary -->
- **Status**: unanswered (linked to ADR 0004 decision on git permissions)
- **Why asking**: Auto-commit requires write permissions on the repo. Manual commit is safer but requires human intervention on every deploy.

**ANS:** (fill in)

---

### QST: Should staging and production use the same pipeline?

- **Status**: unanswered
- **Why asking**: Separate pipelines mean more config to maintain. A single parameterized pipeline is DRY but harder to diff between environments.

**ANS:** (fill in)
