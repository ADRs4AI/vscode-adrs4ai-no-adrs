#!/usr/bin/env python3
"""
last-message.py — Read recent messages from any agent's session JSONL.

Why this exists
---------------

In a multi-agent collaboration, the human is the synchronous bottleneck unless
each agent can independently *see* what other agents are doing. This script
gives each participant — human or AI — visibility into the most recent
messages of any other participant, looked up by a short alias rather than a
UUID.

Two operational benefits, in order of importance:

1. **Per-message model attribution is preserved and surfaced.** Every entry
   shown includes the `model` field as recorded in the session JSONL. This
   is the load-bearing detail: silent model substitutions (classifier
   reroutes, harness-level swaps, deprecations) are NOT visible from inside
   a session — only from the .message.model metadata. Reading
   another agent's recent messages with `just last <alias>` doubles as a
   drift detector.

2. **Cross-session coordination without the human as message bus.** "What
   did agent X just say?" becomes a single command instead of a copy-paste.

Usage
-----

    just last <alias> [k]           # last K assistant messages (default 1)
    just last <alias> 5             # last 5
    just last-full <alias>          # full content (no truncation)
    just aliases                    # show configured aliases
    just discover-sessions          # list recent JSONLs (to find new UUIDs)

Direct invocation:

    python3 scripts/last-message.py <alias> [-k N] [--full]
    python3 scripts/last-message.py --list
    python3 scripts/last-message.py --discover

Configuration: `docs/inbox/agent-sessions.json`

Tool support
------------

Out of the box, this resolves session JSONLs from Claude Code's storage:

    ~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl

where `<cwd-slug>` is the project's working directory with `/` replaced by `-`.

For other tools (Cursor, Cline, Aider, raw API logging), override the storage
discovery by adding a `_storage` block to `docs/inbox/agent-sessions.json`:

    {
      "_schema": 1,
      "_storage": {
        "kind": "claude-code",          // or "custom"
        "base_dir": "~/.claude/projects" // optional override
      },
      "aliases": { ... }
    }

If `kind` is `"custom"`, set `base_dir` to a path where JSONLs live as
`<uuid>.jsonl` directly (no project-slug subdirectory).

Origin
------

Contributed by Statesman 4.7 (Claude Opus 4.7), 2026-06-15, via System3
Conversations. The principle this script operationalizes — per-message model
attribution as drift detector — was named as Doubt 2 of ADR 0042 (Platform
Change Resilience and Drift Detection) in that project, after the framework
caught a silent classifier reroute mid-task.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Resolve the alias config relative to this script. Works regardless of CWD.
ALIAS_FILE = Path(__file__).resolve().parent.parent / "docs" / "inbox" / "agent-sessions.json"

TRUNCATE_DEFAULT = 600  # chars per message body when not --full


def project_slug_from_cwd() -> str:
    """Convert the project's working directory into Claude Code's project-slug form.

    Example: /Users/alice/Programming/my-project
                → -Users-alice-Programming-my-project

    Claude Code stores each project's sessions under:
        ~/.claude/projects/<this-slug>/<session-uuid>.jsonl
    """
    cwd = Path(__file__).resolve().parent.parent  # repo root (script lives in scripts/)
    return str(cwd).replace("/", "-")


def load_config() -> dict:
    """Read the alias file. Returns dict with optional `_schema`, `_storage`, `aliases`."""
    if not ALIAS_FILE.exists():
        sys.exit(
            f"Alias file not found: {ALIAS_FILE}\n"
            "Create one (see docs/inbox/agent-sessions.json template) or run\n"
            "`just discover-sessions` to find session UUIDs for new agents."
        )
    try:
        with ALIAS_FILE.open() as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        sys.exit(f"Alias file is not valid JSON: {e}")


def storage_base_dir(cfg: dict) -> Path:
    """Resolve the directory where session JSONLs live, honoring config override."""
    storage = cfg.get("_storage", {}) or {}
    base = storage.get("base_dir", "~/.claude/projects")
    base_path = Path(os.path.expanduser(base))
    kind = storage.get("kind", "claude-code")
    if kind == "claude-code":
        return base_path / project_slug_from_cwd()
    # "custom" or other: assume <uuid>.jsonl lives directly under base_dir
    return base_path


def resolve_jsonl(alias: str, cfg: dict) -> Path:
    aliases = _real_aliases(cfg)
    if alias not in aliases:
        known = ", ".join(sorted(aliases)) or "(none configured)"
        sys.exit(f"Unknown alias '{alias}'. Known: {known}")
    entry = aliases[alias]
    uuid = entry.get("uuid") if isinstance(entry, dict) else entry
    jsonl = storage_base_dir(cfg) / f"{uuid}.jsonl"
    if not jsonl.exists():
        sys.exit(f"Session JSONL not found for '{alias}': {jsonl}")
    return jsonl


def read_last_messages(jsonl: Path, k: int, role_filter: str | None = "assistant") -> list[dict]:
    """Return the last K JSONL entries matching role_filter (None = all)."""
    matches: list[dict] = []
    with jsonl.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if role_filter is None:
                matches.append(obj)
                continue
            t = obj.get("type")
            msg = obj.get("message") or {}
            role = msg.get("role") or t
            if role == role_filter or t == role_filter:
                matches.append(obj)
    return matches[-k:] if k > 0 else matches


def extract_text(entry: dict) -> str:
    """Pull a sensible text representation from a JSONL entry."""
    msg = entry.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, dict):
                if c.get("type") == "text":
                    parts.append(c.get("text", ""))
                elif c.get("type") == "thinking":
                    continue  # skip internal thinking from default output
                elif c.get("type") == "tool_use":
                    name = c.get("name", "tool")
                    parts.append(f"[tool_use:{name}]")
                elif c.get("type") == "tool_result":
                    parts.append("[tool_result]")
            else:
                parts.append(str(c))
        return "".join(parts)
    return ""


def format_entry(entry: dict, idx: int, total: int, full: bool) -> str:
    msg = entry.get("message") or {}
    model = msg.get("model") or entry.get("type") or "—"
    role = msg.get("role") or entry.get("type") or "—"
    ts = entry.get("timestamp") or ""
    if ts:
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            ts = ts.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        except (ValueError, TypeError):
            pass
    text = extract_text(entry).strip()
    if not full and len(text) > TRUNCATE_DEFAULT:
        text = (
            text[:TRUNCATE_DEFAULT]
            + f"… ({len(text) - TRUNCATE_DEFAULT} more chars; --full to see all)"
        )
    header = f"─── [{idx}/{total}] {role} · model={model} · {ts} ───"
    return f"{header}\n{text}\n"


def cmd_last(args: argparse.Namespace) -> None:
    cfg = load_config()
    jsonl = resolve_jsonl(args.alias, cfg)
    role = None if args.role == "any" else args.role
    msgs = read_last_messages(jsonl, args.k, role_filter=role)
    if not msgs:
        print(f"(no {args.role} messages found in {jsonl.name})")
        return
    alias_meta = cfg.get("aliases", {}).get(args.alias)
    label = args.alias
    if isinstance(alias_meta, dict) and alias_meta.get("role"):
        label = f"{args.alias} ({alias_meta['role']})"
    print(f"═══ {label} — {jsonl.name} ═══")
    for i, m in enumerate(msgs, 1):
        print(format_entry(m, i, len(msgs), args.full))


def _real_aliases(cfg: dict) -> dict:
    """Skip underscore-prefixed keys (treated as comments/metadata in JSON)."""
    return {k: v for k, v in cfg.get("aliases", {}).items() if not k.startswith("_")}


def cmd_list(_args: argparse.Namespace) -> None:
    cfg = load_config()
    aliases = _real_aliases(cfg)
    if not aliases:
        print("(no aliases configured)")
        print(f"Edit {ALIAS_FILE} to add some, then `just discover-sessions` finds UUIDs.")
        return
    print(f"Configured aliases ({ALIAS_FILE}):")
    for name in sorted(aliases):
        meta = aliases[name]
        if isinstance(meta, dict):
            uuid = meta.get("uuid", "?")
            role = meta.get("role", "")
            print(f"  {name:20s}  {uuid}  {('— ' + role) if role else ''}")
        else:
            print(f"  {name:20s}  {meta}")


def cmd_discover(args: argparse.Namespace) -> None:
    """List recent JSONLs in the storage dir, with a hint of their content."""
    cfg = load_config() if ALIAS_FILE.exists() else {"aliases": {}}
    pdir = storage_base_dir(cfg)
    if not pdir.exists():
        sys.exit(f"Storage dir does not exist: {pdir}\n(Override via _storage.base_dir in alias file)")
    jsonls = sorted(pdir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not jsonls:
        sys.exit(f"No JSONLs found in {pdir}")
    known = {}
    for name, v in _real_aliases(cfg).items():
        uuid = v.get("uuid") if isinstance(v, dict) else v
        known[uuid] = name
    print(f"Recent sessions in {pdir}:")
    print(f"{'mtime':25s}  {'uuid':40s}  {'alias':12s}  first-user-message")
    for p in jsonls[: args.limit]:
        mtime = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        uuid = p.stem
        alias = known.get(uuid, "")
        first_user = ""
        try:
            with p.open() as f:
                for line in f:
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("type") == "user" or (obj.get("message", {}) or {}).get("role") == "user":
                        first_user = extract_text(obj) or str((obj.get("message", {}) or {}).get("content", ""))[:80]
                        break
        except OSError:
            pass
        first_user = first_user[:60].replace("\n", " ")
        print(f"{mtime:25s}  {uuid:40s}  {alias:12s}  {first_user}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("alias", nargs="?", help="Agent alias (see --list)")
    p.add_argument("-k", type=int, default=1, help="Number of messages to show (default 1)")
    p.add_argument("--full", action="store_true", help="Show full message bodies, no truncation")
    p.add_argument(
        "--role",
        default="assistant",
        choices=["assistant", "user", "any"],
        help="Filter messages by role (default assistant)",
    )
    p.add_argument("--list", action="store_true", help="List configured aliases")
    p.add_argument("--discover", action="store_true", help="List recent JSONLs to help populate aliases")
    p.add_argument("--limit", type=int, default=15, help="Limit on --discover output (default 15)")
    args = p.parse_args()

    if args.list:
        cmd_list(args)
    elif args.discover:
        cmd_discover(args)
    elif args.alias:
        cmd_last(args)
    else:
        p.print_help()
        sys.exit(2)


if __name__ == "__main__":
    main()
