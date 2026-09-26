"""
Context: companion to 2026-09-26-census-observation-records-for-ribbon-dossier.py.
Ribbon 5's ask #2 (docs/inbox/2026-09-26-1649-ribbon-moreover-to-gleaner-
opinion-request-the-feedback-verb-recut.md): "what survives a round-trip into a
GitHub Issue and back, and what resists?" — an empirical question about the
real record shape. GitHub's issue body/comment limit is 65,536 characters, so
this measures actual serialized record sizes, how many records carry embedded
documents, whether any record has a stable id, and how many human observations
are exact duplicates of another record (multi-root fan-out).

Read-only. Prints to stdout; writes nothing.
"""
import glob
import json
import os
import statistics
from collections import Counter

ROOT = os.path.expanduser('~/Programming')
paths = set()
for pat in ('*/docs/adr/.working/errors.jsonl', '*/*/docs/adr/.working/errors.jsonl',
            '*/*/*/docs/adr/.working/errors.jsonl', '*/*/*/*/docs/adr/.working/errors.jsonl'):
    paths.update(glob.glob(os.path.join(ROOT, pat)))

LIMIT = 65536
sizes_obs, sizes_all = [], []
field_counts = Counter()
payload_keys = Counter()
has_docs = 0
over = 0
n_obs = 0
seen = Counter()
for p in sorted(paths):
    with open(p, encoding='utf8', errors='replace') as f:
        for line in f:
            s = line.rstrip('\n')
            if not s.strip():
                continue
            try:
                r = json.loads(s)
            except Exception:
                continue
            size = len(s.encode('utf8'))
            sizes_all.append(size)
            for k in r:
                field_counts[k] += 1
            if r.get('kind') == 'observation':
                n_obs += 1
                sizes_obs.append(size)
                if r.get('documents'):
                    has_docs += 1
                if size > LIMIT:
                    over += 1
                for k in (r.get('payload') or {}):
                    payload_keys[k] += 1
                seen[((r.get('ts') or '')[:16], (r.get('message') or ''))] += 1

def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))]

print('records total:', len(sizes_all), ' observations:', n_obs)
print('observation size bytes  median=%d  p90=%d  max=%d' % (statistics.median(sizes_obs), q(sizes_obs, .9), max(sizes_obs)))
print('observations > %d bytes: %d (%.0f%%)' % (LIMIT, over, 100 * over / n_obs))
print('observations carrying embedded documents:', has_docs, '(%.0f%%)' % (100 * has_docs / n_obs))
print('top-level fields present (any record):', dict(field_counts))
print('has any id/thread/status field?:', [k for k in field_counts if k in ('id', 'thread', 'in_reply_to', 'status', 'parent')] or 'NONE')
print('observation payload keys:', dict(payload_keys.most_common()))
dupe_groups = sum(1 for v in seen.values() if v > 1)
dupe_extra = sum(v - 1 for v in seen.values() if v > 1)
print('observation filings written to >1 ledger: %d groups, %d extra copies (of %d records)' % (dupe_groups, dupe_extra, n_obs))

# OUTCOME (2026-09-26): see the numbers in docs/inbox/2026-09-26-*-gleaner-to-
# ribbon-*.md — used to ground the round-trip and identity claims in measured
# record shape rather than memory.
