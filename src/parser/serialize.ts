/**
 * ADR-0039 §2 — round-trip gate Tier 1: reconstructing an `AdrFile` back to
 * its exact source text, byte-for-byte, from the SEMANTIC model (not the
 * token stream — that's Tier 0, already proven in tokenizer.ts).
 *
 * Reconstruction is a straight concatenation of the raw spans buildSection()
 * and parseAdr() already capture (`titleRaw`, `preambleRaw`, each top-level
 * section's `headingRaw` + `bodyRaw`) — a section's `bodyRaw` already
 * contains everything from the line after its heading through the next
 * top-level heading (or EOF), children included verbatim, so no recursive
 * per-child reassembly is needed; the top-level sections alone partition
 * the whole remaining file with no gaps.
 *
 * Returns null (never throws) when any required raw span is missing —
 * either there's no title line to anchor to, or a section came from
 * somewhere other than buildSection() (a hand-built test fixture, not a
 * real parse) and never got `headingRaw`/`bodyRaw` populated. A caller
 * asking "does this file round-trip" gets a clear "can't tell" instead of
 * a silently wrong reconstruction.
 */

import type { AdrFile, AdrSection } from './types';

export function serializeAdr(adr: AdrFile): string | null {
  if (adr.titleRaw === undefined || adr.preambleRaw === undefined) return null;

  const parts: string[] = [adr.titleRaw, adr.preambleRaw];
  for (const section of adr.sections) {
    if (section.headingRaw === undefined || section.bodyRaw === undefined) return null;
    parts.push(section.headingRaw, section.bodyRaw);
  }
  return parts.join('\n');
}

/** True when every raw span serializeAdr() needs is actually present. */
export function hasRoundTripFidelity(adr: AdrFile): boolean {
  if (adr.titleRaw === undefined || adr.preambleRaw === undefined) return false;
  return adr.sections.every((s: AdrSection) => s.headingRaw !== undefined && s.bodyRaw !== undefined);
}
