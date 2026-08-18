"""
Context: Lapidary's inbox-archive-sweep brief (docs/inbox/2026-08-16-2300-
lapidary-to-gleaner-inbox-archive-sweep-acted-upon-briefs.md). Rule: archive
a top-level docs/inbox/ brief iff (1) filename date >= 14 days before today,
(2) "acted upon" -- a reply, completion brief, or commit that names it
exists (thread closed), (3) not a standing document.

v2: v1's naive "does the filename appear ANYWHERE in any other file's text"
heuristic produced 270 false "unanswered" hits -- completion/reply briefs
themselves don't need a FURTHER reply to count as closed; they ARE the
closing move. Refined: a file counts as acted-upon if EITHER (a) it is
itself a reply/completion/ack/broadcast (self-closing by its own nature --
detected via filename shape and a "**Re**:" line of its own), OR (b) some
OTHER file's "**Re**:" line names it specifically. Only bare, un-replied-to
fresh DISPATCHES land in the stall list.
"""
import re
import subprocess
import datetime
import json
from pathlib import Path

INBOX = Path("docs/inbox")
TODAY = datetime.date(2026, 8, 18)
CUTOFF = TODAY - datetime.timedelta(days=14)  # 2026-08-04

STANDING = {
    "CONVENTIONS.md", "ENCODING-MAP.md", "agent-sessions.json",
    "INBOX-PROTOCOL.md", "README.md",
}
FOUNDING_PATTERNS = [
    "2026-07-13*riddle*founding*",
    "2026-07-24*midden*founding*",
    "2026-07-31*lapidary-founding-brief*",       # postman seat founding
    "2026-07-31*riddle-founding-brief*",          # Gleaner's own founding brief
    "2026-08-15*docent*founding*",
    "2026-08-15*lapidary-founding-brief*",        # tours owner seat founding
]

date_re = re.compile(r"^(\d{4}-\d{2}-\d{2})")
re_field_re = re.compile(r"\*\*Re\*\*:\s*(.+)")

# Self-closing-by-nature filename shapes: these don't need a further reply
# to be considered "the thread closed" -- they ARE the close.
SELF_CLOSING_SHAPES = [
    "-completion-", "-to-crew-", "broadcast", "-ack", "-ratification",
    "founding-brief", "-welcome-",
]

all_files = sorted(f for f in INBOX.glob("*.md"))
contents = {f.name: f.read_text(errors="replace") for f in all_files}

founding = set()
for pat in FOUNDING_PATTERNS:
    for f in INBOX.glob(pat):
        founding.add(f.name)

# Build: which filenames are referenced by some OTHER file's "**Re**:" line.
referenced_by_re_field = set()
for name, text in contents.items():
    for m in re_field_re.finditer(text):
        target_line = m.group(1)
        # Re: lines usually contain a backtick-quoted filename, or a bare one.
        for other_name in contents:
            if other_name == name:
                continue
            stem = other_name[:-3]
            if other_name in target_line or stem in target_line:
                referenced_by_re_field.add(other_name)

results = []
for f in all_files:
    name = f.name
    text = contents[name]
    m = date_re.match(name)
    if not m:
        results.append({"file": name, "class": "unparseable-date"})
        continue
    fdate = datetime.date(*map(int, m.group(1).split("-")))
    old_enough = fdate <= CUTOFF

    if name in STANDING or name in founding:
        results.append({"file": name, "class": "standing", "date": str(fdate)})
        continue
    if not old_enough:
        results.append({"file": name, "class": "recent", "date": str(fdate)})
        continue

    is_self_closing = any(shape in name for shape in SELF_CLOSING_SHAPES)
    has_own_re_field = bool(re_field_re.search(text))
    is_referenced = name in referenced_by_re_field

    if is_self_closing or has_own_re_field or is_referenced:
        results.append({"file": name, "class": "acted-upon-old", "date": str(fdate)})
    else:
        results.append({"file": name, "class": "unanswered-old", "date": str(fdate)})

by_class = {}
for r in results:
    by_class.setdefault(r["class"], []).append(r["file"])

print("=== SUMMARY (v2) ===")
for cls, files in sorted(by_class.items(), key=lambda kv: -len(kv[1])):
    print(f"{cls}: {len(files)}")

print()
print("=== unanswered-old (stall detector) ===")
for f in sorted(by_class.get("unanswered-old", [])):
    print(f)

with open("scripts/ephemeral/2026-08-18-inbox-sweep-results.json", "w") as fh:
    json.dump(results, fh, indent=2)
print()
print("Full results -> scripts/ephemeral/2026-08-18-inbox-sweep-results.json")
