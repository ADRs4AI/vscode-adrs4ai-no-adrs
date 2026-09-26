"""
Context: Ribbon 5 (moreover) asked, at Jérémie's direct routing (docs/inbox/
2026-09-26-1649-ribbon-moreover-to-gleaner-opinion-request-the-feedback-verb-
recut.md), whether filers classify accurately at filing time (bug vs wish vs
a third kind) — evidence for a cross-tool "reporting pipeline standard".
That is an empirical question about the real corpus, not an opinion question,
so this counts and dumps every human-authored `kind: observation` record
across the ecosystem's errors.jsonl ledgers (truncated messages) so they can
be hand-classified, and tallies record shapes (kind/source) for the
round-trip-to-GitHub-Issue analysis.

Read-only. Prints to stdout; writes nothing.
"""
import glob
import json
import os
from collections import Counter

ROOT = os.path.expanduser('~/Programming')
paths = set()
for pat in ('*/docs/adr/.working/errors.jsonl', '*/*/docs/adr/.working/errors.jsonl',
            '*/*/*/docs/adr/.working/errors.jsonl', '*/*/*/*/docs/adr/.working/errors.jsonl'):
    paths.update(glob.glob(os.path.join(ROOT, pat)))

kinds = Counter()
sources = Counter()
schemas = Counter()
obs = []
for p in sorted(paths):
    repo = p.split('/docs/adr/.working')[0].replace(ROOT + '/', '')
    with open(p, encoding='utf8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            schemas[r.get('schema')] += 1
            kinds[r.get('kind')] += 1
            sources[r.get('source')] += 1
            if r.get('kind') == 'observation':
                obs.append((r.get('ts', '')[:10], repo, r.get('source'), (r.get('message') or '').replace('\n', ' ')))

print('LEDGERS:', len(paths))
print('SCHEMAS:', dict(schemas))
print('SOURCES:', dict(sources))
print('KINDS (top 15):', kinds.most_common(15))
print('OBSERVATION COUNT:', len(obs))
print()
for ts, repo, src, msg in sorted(obs):
    print(f'{ts} | {repo} | {src} | {msg[:260]}')
