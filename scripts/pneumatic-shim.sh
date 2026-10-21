#!/usr/bin/env bash
# pneumatic-shim.sh — the crew layer's ONE front door (HQ ADR-0044, option A;
# the existence-check macro the rights-holder asked for, 2026-10-18).
#
# Every crew recipe in the justfile is a light shim through this file:
#   scripts/pneumatic-shim.sh <verb> [args...]
# It checks that pneumatic exists, teaches the install at the exact moment of
# need when it doesn't, and otherwise EXECs pneumatic with the arguments
# forwarded verbatim ("$@" — no re-quoting, no interpolation: what you typed
# after the verb is what pneumatic receives, flags included).
#
# Why a shim and not ten copies of a check: the justfile is a scaffold — "an
# embedded incubator of functionality … a launchpad for stable intermediate
# forms" (the rights-holder, ADR-0044 ANS). The crew verbs molted into the
# pneumatic porcelain; these shims are the light residue the incubator keeps.
set -euo pipefail

if ! command -v pneumatic >/dev/null 2>&1; then
    echo "❌ The crew layer runs on pneumatic — one install carries all of it:" >&2
    echo "     pip install adrs4ai-pneumatic        (or: pipx install adrs4ai-pneumatic)" >&2
    echo "   Manual: https://adrs.systems/pneumatic" >&2
    echo "   Every non-crew recipe (adr, seed, gate, brief filenames, instantiate-check) works without it." >&2
    exit 1
fi

exec pneumatic "$@"
