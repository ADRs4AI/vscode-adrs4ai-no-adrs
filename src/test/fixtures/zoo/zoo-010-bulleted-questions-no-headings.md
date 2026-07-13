# ADR 0016: LADD Detection Architecture

- **Date**: 2026-06-02
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

---

<!-- Deviation: "## QST: Open Questions" reuses the QST token as a generic section
     label (not an actual question), and the three real open questions below are
     bullet items ("- QST: ...") instead of "### QST:" headings — no Status field,
     no ANS block, for any of them. A heading-based parser finds zero questions here. -->
## QST: Open Questions

- QST: Should raw_positions store a flags column to preserve extra state alongside the primary classification? (Proposed yes — see note above)
- QST: How do we handle the weekly sync failure case — should we alert if the download fails?
- QST: Does the downstream consumer auto-update its database? If not, it may lag behind the source after a weekly sync.
