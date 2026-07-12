# ADR-0003: Recipe Photo Storage — Local Disk vs. S3-Compatible Object Storage

- **Date**: 2026-06-14
- **Iteration**: 1
- **Status**: Accepted
- **Deciders**: Ren Okafor, Sonnet 4.6 (1M)

---

## Quick Reference

**Navigation codes** (for grep):
- `QST:` Questions
- `ANS:` Answers
- `NOT:` Notes

---

## Human Context

Recipes get photos — the finished dish, sometimes step-by-step shots. For the self-hosted version this is just files on disk, easy. But I want the same code path to work if someone points Larder at an S3-compatible bucket (Backblaze B2, MinIO, whatever), because photo storage is exactly the kind of thing that outgrows a single disk quietly and then all at once.

---

## AI Interpretation

**What I understand you're asking**: a storage abstraction that defaults to local disk (zero-config self-hosting, same posture as [ADR-0001](adr:0001#qst-session-cookies-or-jwt)'s auth decision) but doesn't require rewriting upload/serve code when someone swaps in object storage later.

---

## Questions

### QST: Local filesystem, S3-compatible object storage, or both behind one interface?
- Status: answered
- Why asking: The zero-config self-hosting goal and the "don't outgrow this quietly" goal point in slightly different directions, same shape as the datastore and auth decisions before it.
- Need: pick a default and confirm the abstraction boundary

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-14)

**Both, behind one `PhotoStore` interface — local filesystem as the zero-config default, S3-compatible as an opt-in config flag.** This is the same pattern as [ADR-0001](adr:0001#qst-session-cookies-or-jwt): pick the zero-dependency default for self-hosting, but don't foreclose the path that scales. Unlike the auth decision, there's no revocation-style trap here — a filesystem-backed and an S3-backed implementation of the same three methods (`put`, `get`, `delete`) is a genuinely thin abstraction, not a stateless-vs-stateful tradeoff in disguise.

**ANS:** (by Ren Okafor)
Agreed, and honestly this one wasn't hard to decide once you framed it as "is this actually the same trap as the auth one" — it isn't. Ship the interface.

---

## Decision

### Chosen: `PhotoStore` interface, local filesystem default

**Why**: Zero-config self-hosting stays true (no bucket, no credentials needed to get started), and the object-storage path is a drop-in implementation of the same three-method interface, not a parallel code path.

### Consequences

- Photo URLs are always served through the app (`/photos/:id`), never a raw filesystem or bucket path — this is what makes the swap invisible to the frontend
- Local filesystem default writes to a `data/photos/` volume, documented in the Docker Compose file as the one directory that must be backed up

---

## Iterations

### Iteration 1 (2026-06-14)
- Human: Named the tension between zero-config self-hosting and not quietly outgrowing local disk
- AI (Sonnet 4.6): Recognized the pattern from ADR-0001, distinguished it as a thin-abstraction case rather than a stateless-vs-stateful trap, recommended a `PhotoStore` interface
- Outcome: **Accepted** same day

---

## Links

- Related ADRs: ADR-0001 (Authentication — the same zero-config-default-with-an-escape-hatch shape)
