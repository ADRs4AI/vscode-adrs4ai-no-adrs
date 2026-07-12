# SEED: Offline mode and multi-device sync

- **Date**: 2026-07-01
- **From**: Ren Okafor

---

## Brain Dump

Been thinking about this while grocery shopping with spotty signal in the store basement (of course) — the grocery list needs to work offline. Dumping everything before I lose the thread.

**Offline-first for the grocery list specifically.** Not the whole app — recipes and pantry can require a connection, that's fine, you're usually home for those. But the grocery list is the one screen people actually use standing in a store with bad signal. It needs to: load the last-synced list instantly, let you check items off with zero network calls, and sync whenever a connection shows back up. This probably means the grocery list needs its own local-first storage layer (IndexedDB on web, SQLite on mobile) that's separate from "ask the server for everything."

**Conflict resolution when it comes back online.** If I check off "milk" on my phone in the store while my partner adds "oat milk" from the kitchen tablet at the same time, both changes need to survive the sync. This is different from the pantry concurrent-write question in ADR-0002 — that one's about two people editing at the *same time while both online*; this is about one person offline for twenty minutes with local changes queued up. I think it's a CRDT-shaped problem (grow-only set for "items added," separate op log for "items checked off") but I don't want to reach for a CRDT library if a dumber approach works — maybe just: additions always merge (union of both lists), and "checked off" state merges as "checked off wins" (if either device marked it checked, it's checked, never un-checks automatically).

**How does the app know it's back online?** Browser has `navigator.onLine` but that's notoriously unreliable (it lies in both directions — says online when the network is actually captive-portal-blocked, says offline when it's actually fine). Probably need an actual health-check ping to the server, not just the browser API, before trying to flush the sync queue.

**Push notifications for shared-list changes?** If my partner adds something to the list while I'm mid-shop, it'd be nice to see it appear without me pulling to refresh. This is a "nice to have," not blocking — could be a dumb poll-every-30-seconds while the grocery list screen is open, doesn't need real push infrastructure for v1.

**Mobile app vs. PWA question is upstream of all of this** and I haven't decided it yet — if it's a PWA, offline storage is IndexedDB and background sync is the Background Sync API (spotty browser support); if it's a native-ish wrapper (Capacitor or similar), it's SQLite and a real background task. I don't want to block the offline-mode design entirely on the PWA-vs-native decision, but the *storage layer* choice probably does depend on it, so maybe that's actually the first ADR to chunk out of this, not last.

One more thing, smaller: should the sync conflict behavior be visible to the user at all, or fully silent? I lean silent (nobody wants to resolve a merge conflict for a grocery list), but "checked off wins, no undo" is a real behavior a user could be confused by if they don't know it's the rule ("wait, why did that come back checked?").

---

**Model Response Request:**

- [ ] Chunk this into ADRs (I'm ready to formalize)
- [x] Iterate with me (keep exploring)
- [ ] Structure in place (organize but don't split)

---

## Thread

### Sonnet 4.6 (1M) - 2026-07-02

Read the whole dump. Before chunking anything, one thing needs resolving first — you flagged it yourself as "upstream of all of this," and I think it's sharper than that: it's not just upstream, it changes what "the storage layer ADR" is even about.

If Larder ships as a PWA, offline storage is IndexedDB and sync is the Background Sync API (patchy browser support — you'd likely need a foreground-tab fallback). If it's a native-ish wrapper, it's SQLite and a real background task with none of the Background Sync API's reliability problems, but a heavier app to ship. These aren't two implementations of the same ADR — they're two different storage layers with different failure modes, and "sync conflict resolution" (your CRDT-shaped question) depends on which one you're resolving conflicts *in*.

So before I chunk this into the three ADRs you sketched, I think there's a zeroth one:

### QST: Should the offline storage layer decision wait on PWA-vs-native, or be spec'd generically enough to survive either?
- Status: unanswered
- Why asking: If storage waits on PWA-vs-native, that decision blocks two others behind it (storage layer, then conflict resolution) — a real sequencing cost if PWA-vs-native takes a while to settle. If storage can be spec'd generically (e.g., "a local-first store with `put`/`get`/`delete` and a change-log," implementation-agnostic), the other two ADRs can proceed in parallel and get narrowed once the platform choice lands.
- Need: sequencing preference — strict chain, or parallel-with-a-generic-interface

**Recommendation**: (by Sonnet 4.6 (1M), 2026-07-02)

**Spec storage generically now, narrow it once PWA-vs-native lands — don't block the chain.** The conflict-resolution logic you sketched (additions merge as union, checked-off wins) doesn't actually depend on whether the underlying store is IndexedDB or SQLite; it depends on there being *a local store with a change log*, which both platforms can provide behind the same three-method interface. This is the same pattern as ADR-0003's `PhotoStore`: pick the abstraction boundary now, let the platform choice fill in the implementation later instead of gating on it.

**ANS:** (by Ren Okafor)
[Fill this in]

---

## Derived Into

*(This seed has not yet been chunked into ADRs)*
