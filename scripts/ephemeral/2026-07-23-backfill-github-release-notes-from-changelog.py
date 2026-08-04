#!/usr/bin/env python3
"""
Backfill GitHub Release bodies with their CHANGELOG.md entry.

Context: docs/inbox/2026-07-23-0105-lapidary-correction-item-2-is-github-
release-notes-not-an-extension-surface.md — Jérémie's actual ask ("it's just
in GitHub, in the release message") got over-extrapolated into an in-extension
"What's New" surface (struck, see ADR-0033). The real ask: every GitHub
Release body should carry that version's changelog entry instead of the
generic auto-generated boilerplate ("Navigate and manage Architectural
Decision Records..." repeated verbatim on all 27 releases).

Approach: parse CHANGELOG.md into per-version sections, fetch each release's
current body via `gh release view`, replace the generic one-line description
with the real changelog content (everything else in the body — Install
instructions, test count, Full Changelog link, any hand-written notes like
v0.5.2's test-count-bug correction — preserved verbatim), then push the new
body with `gh release edit`.

Dry-run by default; pass --apply to actually call `gh release edit`.
"""
import re
import subprocess
import sys
import argparse

CHANGELOG_PATH = "CHANGELOG.md"
GENERIC_DESCRIPTION = (
    "Navigate and manage Architectural Decision Records for human-AI "
    "collaboration (collab-adr-lean format)."
)


def parse_changelog(path: str) -> dict[str, str]:
    """Returns {version: markdown_body} for each '## [X.Y.Z] - date' section."""
    text = open(path, encoding="utf-8").read()
    # Split on version headings, keeping the heading line out of the captured body
    # (the release body already has its own '## ADRs for AI vX.Y.Z' title).
    pattern = re.compile(r"^## \[([\d.]+)\] - \d{4}-\d{2}-\d{2}\s*$", re.MULTILINE)
    matches = list(pattern.finditer(text))
    sections = {}
    for i, m in enumerate(matches):
        version = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip("\n")
        sections[version] = body
    return sections


def get_release_tags() -> list[str]:
    out = subprocess.run(
        ["gh", "release", "list", "--limit", "100", "--json", "tagName"],
        capture_output=True, text=True, check=True,
    )
    import json
    return [r["tagName"] for r in json.loads(out.stdout)]


def get_release_body(tag: str) -> str:
    out = subprocess.run(
        ["gh", "release", "view", tag, "--json", "body"],
        capture_output=True, text=True, check=True,
    )
    import json
    return json.loads(out.stdout)["body"]


def build_new_body(old_body: str, changelog_section: str) -> str | None:
    if GENERIC_DESCRIPTION not in old_body:
        return None  # already customized, or format changed — don't touch blindly
    return old_body.replace(GENERIC_DESCRIPTION, changelog_section, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Actually call gh release edit")
    args = ap.parse_args()

    sections = parse_changelog(CHANGELOG_PATH)
    tags = get_release_tags()

    updated, skipped_no_changelog, skipped_no_match = [], [], []

    for tag in sorted(tags, key=lambda t: [int(x) for x in t.lstrip("v").split(".")]):
        version = tag.lstrip("v")
        if version not in sections:
            skipped_no_changelog.append(tag)
            continue
        old_body = get_release_body(tag)
        new_body = build_new_body(old_body, sections[version])
        if new_body is None:
            skipped_no_match.append(tag)
            continue
        updated.append(tag)
        if args.apply:
            subprocess.run(
                ["gh", "release", "edit", tag, "--notes", new_body],
                check=True,
            )
            print(f"[applied] {tag}")
        else:
            print(f"[dry-run] would update {tag} ({len(new_body)} chars)")

    print()
    print(f"Updated: {len(updated)} — {updated}")
    print(f"Skipped (no CHANGELOG entry for this version): {skipped_no_changelog}")
    print(f"Skipped (generic description not found, body already customized?): {skipped_no_match}")


if __name__ == "__main__":
    sys.exit(main())
