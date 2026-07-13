# ADR 0005: GitHub Action Design

- **Date**: 2026-02-20
- **Iteration**: 1
- **Status**: Accepted
- **Deciders**: Jérémie Lumbroso

---

## Questions

### QST: Should the Action automatically commit and push canvas_urls.json?

- Status: answered
- Why asking: Determines whether the pipeline is fully automated or needs a manual step.

<!-- Deviation: **ANS:** with no "(by [name])" attribution at all — answer text starts on the very next line -->
**ANS:**
I've answered this question extensively in ADR 0004: yes, the Action commits and pushes automatically, gated on CI passing.
