# Testing Standard MADR Parsing

* Status: proposed
* Deciders: Test User
* Date: 2026-01-15

## Context and Problem Statement

This is a test fixture for the standard MADR format (older elenchus-style).
The parser should detect this as 'madr-standard' and not crash.

## Decision Drivers

* Must parse without errors
* Should show in tree view as [proposed]
* Should have zero open questions (no QST blocks)

## Considered Options

* Option A: Parse it
* Option B: Skip it

## Decision Outcome

Chosen option: Option A. Best-effort parse, emit BULLET_FORMAT warning.
