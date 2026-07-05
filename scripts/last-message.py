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
import re
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


def read_jsonl_tail(jsonl: Path, max_bytes: int = 65536) -> list[dict]:
    """Read the last ~max_bytes of a JSONL, parse backwards to get final messages.

    Returns messages in chronological order (oldest to newest from the tail window).
    Efficient for large files — only reads the end.
    """
    if not jsonl.exists():
        return []
    size = jsonl.stat().st_size
    if size == 0:
        return []

    # Read last max_bytes (or whole file if smaller)
    read_size = min(size, max_bytes)
    with jsonl.open('rb') as f:
        f.seek(size - read_size)
        tail_bytes = f.read()

    # Decode and split into lines
    try:
        tail_text = tail_bytes.decode('utf-8', errors='ignore')
    except Exception:
        return []

    lines = tail_text.split('\n')
    # First line might be partial (we seeked mid-line), skip it
    if len(lines) > 1:
        lines = lines[1:]

    messages = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            messages.append(obj)
        except json.JSONDecodeError:
            continue

    return messages


def classify_seat(jsonl: Path, stale_threshold_hours: float = 6.0) -> dict:
    """Classify a seat's health status from its JSONL tail.

    Returns dict with: state (ERROR/WAITING/STALE/OK), emoji, model, age_str, text_preview
    """
    # Read tail efficiently
    messages = read_jsonl_tail(jsonl, max_bytes=65536)

    # Find last assistant message
    last_assistant = None
    for msg in reversed(messages):
        msg_obj = msg.get("message", {})
        role = msg_obj.get("role") or msg.get("type")
        if role == "assistant":
            last_assistant = msg
            break

    if not last_assistant:
        # No assistant messages in tail — treat as stale
        mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc)
        age = datetime.now(timezone.utc) - mtime
        age_str = format_age(age)
        return {
            "state": "STALE",
            "emoji": "🟡",
            "model": "—",
            "age_str": age_str,
            "text_preview": "(no assistant messages in tail)",
        }

    # Extract fields
    msg_obj = last_assistant.get("message", {})
    model = msg_obj.get("model") or "—"
    text = extract_text(last_assistant).strip()
    preview = text[:80].replace("\n", " ") if text else "(empty)"

    # Get age from timestamp
    ts_str = last_assistant.get("timestamp") or ""
    if ts_str:
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            age = datetime.now(timezone.utc) - ts
            age_str = format_age(age)
            age_hours = age.total_seconds() / 3600
        except (ValueError, TypeError):
            age_str = "?"
            age_hours = 0
    else:
        # Fall back to file mtime
        mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc)
        age = datetime.now(timezone.utc) - mtime
        age_str = format_age(age)
        age_hours = age.total_seconds() / 3600

    # Classification logic

    # 🔴 ERROR — model=<synthetic> OR body matches ^API Error
    if model == "<synthetic>" or text.startswith("API Error"):
        return {
            "state": "ERROR",
            "emoji": "🔴",
            "model": model,
            "age_str": age_str,
            "text_preview": preview,
        }

    # 🟡 WAITING — ends in question + age > threshold
    last_lines = [line for line in text.split('\n')[-3:] if line.strip()]
    ends_with_question = any('?' in line for line in last_lines[-2:])
    if ends_with_question and age_hours > 1.0:  # 1 hour threshold for waiting
        return {
            "state": "WAITING",
            "emoji": "🟡",
            "model": model,
            "age_str": age_str,
            "text_preview": preview,
        }

    # 🟡 STALE — no JSONL append in > threshold, no terminal question
    if age_hours > stale_threshold_hours and not ends_with_question:
        return {
            "state": "STALE",
            "emoji": "🟡",
            "model": model,
            "age_str": age_str,
            "text_preview": preview,
        }

    # 🟢 OK — anything else
    return {
        "state": "OK",
        "emoji": "🟢",
        "model": model,
        "age_str": age_str,
        "text_preview": preview,
    }


def format_age(delta) -> str:
    """Format a timedelta as compact age string (e.g., '2h', '45m', '3d')."""
    seconds = delta.total_seconds()
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds / 60)}m"
    elif seconds < 86400:
        return f"{int(seconds / 3600)}h"
    else:
        return f"{int(seconds / 86400)}d"


def cmd_pulse(args: argparse.Namespace) -> None:
    """One-line health check per registered seat.

    Detects stalls, errors, and blocked states across all agents.
    Output format: <emoji> <alias> <state> age=<time> model=<model> "<preview>"
    """
    cfg = load_config()
    aliases = _real_aliases(cfg)

    if not aliases:
        print("(no aliases configured)")
        return

    # Collect all seat statuses
    results = []
    for alias in sorted(aliases):
        try:
            jsonl = resolve_jsonl(alias, cfg)
            status = classify_seat(jsonl, stale_threshold_hours=args.stale_threshold)
            results.append((alias, status))
        except SystemExit:
            # JSONL not found — treat as missing
            results.append((alias, {
                "state": "MISSING",
                "emoji": "⚫",
                "model": "—",
                "age_str": "—",
                "text_preview": "(JSONL not found)",
            }))

    # Print results
    for alias, status in results:
        # Get display name or role (if --verbose)
        alias_meta = aliases.get(alias)
        name_suffix = ""
        if isinstance(alias_meta, dict):
            if args.verbose and alias_meta.get("role"):
                # Verbose mode: show full role paragraph (no truncation in name field,
                # but still cap text preview at 60 to keep some structure)
                name_suffix = f" ({alias_meta['role']})"
            elif alias_meta.get("display_name"):
                # Default: show short display_name if available
                name_suffix = f" ({alias_meta['display_name']})"
            # Else: no suffix (just alias)

        # Format line: in default mode, keep tight; in verbose mode, let name expand
        if args.verbose:
            # Verbose: no width limit on name, but keep preview at 60
            print(
                f"{status['emoji']} {alias:15s}{name_suffix} "
                f"{status['state']:8s} age={status['age_str']:6s} "
                f"model={status['model']:20s} \"{status['text_preview'][:60]}\""
            )
        else:
            # Default: tight layout with fixed widths
            print(
                f"{status['emoji']} {alias:15s}{name_suffix[:25]:25s} "
                f"{status['state']:8s} age={status['age_str']:6s} "
                f"model={status['model']:20s} \"{status['text_preview'][:60]}\""
            )

    # Summary counts
    error_count = sum(1 for _, s in results if s['state'] == 'ERROR')
    waiting_count = sum(1 for _, s in results if s['state'] == 'WAITING')
    stale_count = sum(1 for _, s in results if s['state'] == 'STALE')
    ok_count = sum(1 for _, s in results if s['state'] == 'OK')

    print()
    print(f"Summary: {error_count} ERROR, {waiting_count} WAITING, {stale_count} STALE, {ok_count} OK")

    # Exit code: non-zero if any errors
    if error_count > 0:
        sys.exit(1)


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
    p.add_argument("--pulse", action="store_true", help="Health check: one line per seat, detect stalls/errors")
    p.add_argument("--stale-threshold", type=float, default=6.0, help="Hours before marking STALE (default 6)")
    p.add_argument("--verbose", action="store_true", help="Show full role descriptions in pulse output (default: display_name only)")
    p.add_argument("--limit", type=int, default=15, help="Limit on --discover output (default 15)")
    args = p.parse_args()

    if args.list:
        cmd_list(args)
    elif args.discover:
        cmd_discover(args)
    elif args.pulse:
        cmd_pulse(args)
    elif args.alias:
        cmd_last(args)
    else:
        p.print_help()
        sys.exit(2)


if __name__ == "__main__":
    main()
