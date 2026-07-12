# ADR-0001: Authentication — Session Cookies vs. JWT

- **Date**: 2026-06-02
- **Iteration**: 2
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

Larder is meant to be self-hosted — one Docker Compose file, no external services. I don't want auth to force a dependency on Redis or a hosted identity provider just to keep someone logged in.

At the same time I know I'll eventually want a small hosted tier for people who don't want to run their own server, and that version will probably run more than one instance behind a load balancer. So whatever we pick now shouldn't paint us into a corner later.

**Agency Grant**: Pick a default and justify it — I trust the reasoning more than my own gut here, I've flip-flopped on this twice already.

---

## AI Interpretation

**What I understand you're asking**: whether the self-hosted-first constraint (no Redis, no external IdP) is compatible with an eventual multi-instance hosted tier, and which of the two standard mechanisms — server-side session cookies or stateless JWTs — serves both without over-engineering the version that ships first.

**Assumptions I'm making**:
- Single-user or small-household use is the dominant case for the self-hosted version (a handful of people sharing one pantry, not thousands of tenants)
- "Eventually hosted" is a real constraint to design around, not a hypothetical to ignore

---

## Questions

### QST: Session cookies or JWT?
- Status: answered
- Why asking: This is the one decision everything else in the auth layer builds on — revocation, multi-device logout, and the hosted-tier migration path all depend on it.
- Need: pick one, with the hosted-tier future in mind

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-01)

**JWT — stateless tokens, no server-side session store.** Given the stated goal of an eventual multi-instance hosted tier, statelessness avoids a shared-session-store dependency (Redis or a sticky-session load balancer) that the self-hosted version doesn't need today but the hosted version will. Ship it now, use it later — one mechanism for both deployment shapes.

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-02, walking back the JWT lean after Ren's revocation question below)

**Session cookies backed by a `sessions` table, not JWT.** The stateless win doesn't hold up against the actual failure mode: JWT revocation before expiry requires a denylist, which is a server-side store anyway — the exact dependency JWT was supposed to avoid, just reintroduced through the back door with worse ergonomics (a token that's technically still "valid" until an app-layer check rejects it). A `sessions` table in the same SQLite/Postgres instance Larder already needs is one less moving part, not one more, and "logout everywhere" becomes a single `DELETE`. For the hosted tier: sticky sessions or a shared session table across instances are both well-trodden, and neither is worse than running a denylist.

**ANS:** (by Ren Okafor)
Yeah, the revocation thing is what got me — I want "log out this device" to actually mean logged out, not "technically still valid for up to 15 more minutes." Going with session cookies. If the hosted tier ever needs it, we can revisit, but I'd rather solve a real scaling problem later than a hypothetical one now.

---

## Decision

### Context

Larder needs an auth mechanism that works for a single Docker Compose deployment today without assuming a future hosted, multi-instance tier that doesn't exist yet — but shouldn't require a rewrite when that tier does exist.

### Options

**Option A — JWT (stateless)**
- Pros: no shared session store needed across instances
- Cons: revocation requires a denylist — a server-side store by another name, with worse ergonomics

**Option B — Session cookies + `sessions` table**
- Pros: immediate, correct revocation ("logout everywhere" is one query); reuses the datastore Larder already has
- Cons: hosted multi-instance tier needs either sticky sessions or a shared session table (both standard, neither exotic)

### Chosen: Option B — HTTP-only session cookies, `sessions` table

**Why**: Revocation correctness matters more than statelessness for an app whose primary use case is a shared household pantry — someone needs to be able to kick a device off immediately (shared laptop, borrowed tablet). JWT's revocation story doesn't actually avoid a server-side store; it just makes the store's absence a lie.

**Trade-offs accepted**: the hosted tier will need a shared session table or sticky sessions across instances — a known, standard problem, deliberately deferred rather than solved speculatively.

### Consequences

- `sessions` table ships in the same migration as the `users` table — no separate auth service
- "Log out everywhere" is a real, immediate feature, not a documented limitation
- Hosted-tier session sharing is an explicitly named future decision, not a silent gap

---

## Iterations

### Iteration 1 (2026-06-01)
- Human: Named the self-hosted-first constraint and the eventual hosted-tier future; asked for a default with reasoning
- AI (Sonnet 4.6): Recommended JWT for statelessness against the multi-instance future
- Outcome: Recommendation given; Ren's follow-up question about revocation reopened it same day

### Iteration 2 (2026-06-02)
- Human: Asked directly what happens when a device needs to be logged out before token expiry
- AI (Sonnet 4.6): Walked back the JWT recommendation — revocation-before-expiry needs a denylist, which reintroduces the dependency JWT was chosen to avoid; recommended session cookies instead
- Outcome: **Accepted** — session cookies with a `sessions` table

---

## Links

- Related ADRs: ADR-0002 (Primary Datastore — the `sessions` table lands wherever that decision lands)
