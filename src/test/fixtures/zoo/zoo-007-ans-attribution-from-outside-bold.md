# ADR 0025: Comprehensive Testing Roadmap

- **Date**: 2026-05-11
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

---

## Questions

### QST: Should coverage gate merges at 80%?

- Status: answered
- Why asking: A hard gate blocks merges; a soft target relies on discipline.

<!-- Deviation: "**ANS**: (from X)" — colon OUTSIDE the bold span, "from" instead of "by" -->
**ANS**: (from Jérémie) Yes, because the logging needs to be accurate and coverage regressions are otherwise invisible until it's too late.

---

### QST: Should flaky tests auto-retry or auto-quarantine?

- Status: answered
- Why asking: Auto-retry hides flakiness; auto-quarantine risks losing real coverage silently.

**ANS**: (from Jérémie) Auto-quarantine, with a weekly report of quarantined tests so they don't disappear forever.
