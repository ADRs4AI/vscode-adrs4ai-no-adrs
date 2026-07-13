/**
 * ADR Parser — Stage 2: Semantic Extractor
 *
 * Takes the structural output from the tokenizer and extracts ADR-specific
 * entities: metadata, sections with nav codes, questions, iterations, etc.
 *
 * This is where all ADR format knowledge lives.
 * See ADR-0002 for the design rationale and data model.
 */

import * as crypto from 'crypto'
import * as path from 'path'
import { KNOWN_STATUS_VALUES, requiresScopeRemaining } from './statusInfo'
import { tokenize, extractRawSections, type RawSection, type Token } from './tokenizer'
import { unwrapListItems, unwrapParagraphs } from './hardwrap'
import type {
  AdrFile,
  AdrFormat,
  AdrSection,
  AdrStatus,
  AdrIteration,
  DeepLink,
  FormatDetectionResult,
  InlineNavCode,
  NavCode,
  ParseWarning,
  ParseWarningCode,
  Question,
  QuestionAnswer,
  Recommendation,
} from './types'
import { KNOWN_STATUSES } from './types'

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** All heading text that strongly signals collab-adr-lean format */
const COLLAB_ADR_LEAN_SIGNALS = [
  'Quick Reference',
  'Human Context',
  'AI Interpretation',
  'Iterations',
  'Validation',
];

/** All heading text (or prefixes) that signal standard MADR */
const MADR_STANDARD_SIGNALS = [
  'Context and Problem Statement',
  'Decision Drivers',
  'Considered Options',
  'Decision Outcome',
  'Pros and Cons of the Options',
];

/** Regex for nav code headings (### QST: ..., ### NOT: ..., etc.) */
const NAV_CODE_HEADING_RE = /^(QST|ANS|COD|API|FIL|DOC|NOT):\s+(.*)$/;

// ADR-0024: the strict form above is exact-match, case-sensitive, and requires
// whitespace after the colon. A heading that only deviates in case (### qst:)
// or has a glued colon (### QST:Question) matched neither NAV_CODE_HEADING_RE
// nor NONSTANDARD_QST_HEADING_RE (below, which only catches "### QST-N:"), so
// navCode came back undefined and the question silently vanished from the
// Open Questions panel — no ParseWarning, no diagnostic, nothing (Postel's
// law violation: the parser should accept liberally and flag, not drop).
// This tolerant form recovers the question; NONCANONICAL_NAV_CODE_HEADING
// (below) keeps the deviation from disappearing silently.
const NAV_CODE_HEADING_TOLERANT_RE = /^(QST|ANS|COD|API|FIL|DOC|NOT):\s*(.*)$/i;

// HQ ADR-0012 (QST Identifier Grammar — Blessing the Handle, 2026-07-11):
// explicit, author-chosen question handles — "### QST-<ID>: <title>" —
// canonical-optional alongside plain "### QST: <title>". Only QST gets this
// id-suffix grammar (ANS/COD/etc. aren't cited across inbox briefs and deep
// links the way questions are). Checked BEFORE the generic nav-code regexes
// above: "QST-A:" matches neither (confirmed independently by concertmaster-5
// in companion-thinking-stream-etude and by this repo — the motivating
// incident for the HQ ADR). `id` accepts Unicode letters/digits on input
// (so "QST-JÉRÉMIE" can be typed) and is NFD-folded to the ratified bounded
// ASCII charset before use — see foldQstId().
const QST_HANDLE_RE = /^QST-([\p{L}\p{N}]{1,12}):\s*(.*)$/u;
// Tolerant fallback (same posture as ADR-0024): a lowercase/mixed-case "QST"
// keyword ("qst-a: Title") would otherwise fall through this AND the generic
// nav-code regexes (which need literal "QST:", no hyphen-id support) —
// shipping this grammar without a case-tolerant fallback would reopen the
// exact silent-drop hole it exists to close, just spelled differently.
const QST_HANDLE_TOLERANT_RE = /^qst-([\p{L}\p{N}]{1,12}):\s*(.*)$/iu;

/**
 * NFD-normalize, strip combining marks (diacritics), uppercase, keep only
 * [A-Z0-9] — "QST-JÉRÉMIE" → "JEREMIE" (HQ ADR-0012 Iteration 2, "fold,
 * don't forbid": authoring with accents is accepted input; the substrate
 * files with its spine, not the author's keyboard). Re-bounded to 12 chars
 * after folding — combining-mark stripping only shortens in practice, but
 * this keeps the {1,12} invariant explicit rather than assumed.
 */
function foldQstId(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks (U+0300-U+036F)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

export function detectFormat(tokens: ReturnType<typeof tokenize>): FormatDetectionResult {
  const headings = tokens
    .filter((t): t is ReturnType<typeof tokenize>[number] & { kind: 'heading' } => t.kind === 'heading')
    .map(t => t.text);

  const signals: string[] = [];

  // Strong signal: any heading that starts with a nav code
  if (headings.some(h => NAV_CODE_HEADING_RE.test(h))) {
    signals.push('nav-code-heading');
  }

  const collabSignals = COLLAB_ADR_LEAN_SIGNALS.filter(s => headings.includes(s));
  if (collabSignals.length > 0) {
    signals.push(...collabSignals.map(s => `collab-section:${s}`));
  }

  const madrSignals = MADR_STANDARD_SIGNALS.filter(s => headings.includes(s));
  if (madrSignals.length > 0) {
    signals.push(...madrSignals.map(s => `madr-section:${s}`));
  }

  if (signals.some(s => s === 'nav-code-heading' || s.startsWith('collab-section'))) {
    return { format: 'collab-adr-lean', confidence: 'high', signals };
  }

  if (madrSignals.length >= 2) {
    return { format: 'madr-standard', confidence: 'high', signals };
  }

  if (madrSignals.length === 1) {
    return { format: 'madr-standard', confidence: 'medium', signals };
  }

  // Has at least a title + some content?
  const hasTitle = tokens.some(t => t.kind === 'heading' && t.level === 1);
  const hasContent = tokens.some(t => t.kind === 'heading' && t.level === 2);
  if (hasTitle && hasContent) {
    return { format: 'madr-partial', confidence: 'low', signals: ['has-title-and-sections'] };
  }

  return { format: 'unknown', confidence: 'low', signals: ['no-structure-detected'] };
}

// ---------------------------------------------------------------------------
// Metadata extraction (from header bullet list)
// ---------------------------------------------------------------------------

// Matches: - **Key**: value  OR  - **Key (with spaces)**: value
const BOLD_BULLET_RE = /^-\s+\*\*([^*:]+)\*\*:\s+(.+)$/;
// Matches: - Key: value  (dash bullet, unbold key — ADR-0014 D6.5 MISSING_BOLD_ON_PREAMBLE_FIELD)
const DASH_PLAIN_BULLET_RE = /^-\s+([^*:]+):\s+(.+)$/;
// Matches: * Key: value  (old-style MADR)
const PLAIN_BULLET_RE = /^\*\s+([^:]+):\s+(.+)$/;

interface ExtractedMetadata {
  date?: string;
  iteration: number;
  status?: AdrStatus;
  scopeRemaining?: string;
  awaiting?: string;
  awaitingCondition?: { adr: string; predicate: string };
  deciders: string[];
  warnings: ParseWarning[];
}

// ADR-0014 Iteration 2: "- **Awaiting**: ADR-0035 == implemented" (or "ADR 0035", "== accepted", etc.)
const AWAITING_DSL_RE = /^ADR[-\s]?(\d+)\s*==\s*(.+)$/i;

function extractMetadata(tokens: Token[], lineOffset = 0): ExtractedMetadata {
  const result: ExtractedMetadata = { iteration: 1, deciders: [], warnings: [] };

  for (const token of tokens) {
    if (token.kind !== 'body') continue;
    const text = token.text.trim();
    if (!text.startsWith('-') && !text.startsWith('*')) continue;

    let key: string | undefined;
    let value: string | undefined;

    const boldMatch = text.match(BOLD_BULLET_RE);
    if (boldMatch) {
      key = boldMatch[1].toLowerCase().trim();
      value = boldMatch[2].trim();
    } else {
      // ADR-0014 D6.5 MISSING_BOLD_ON_PREAMBLE_FIELD: field present, key unbold
      // ("- Status: Draft"). Postel's Law (ADR-0012): accept and extract the
      // value silently here — no ParseWarning, the field IS present, it's a
      // format deviation the normalizer's D6.5 handler proposes fixing.
      const dashPlainMatch = text.match(DASH_PLAIN_BULLET_RE);
      if (dashPlainMatch) {
        key = dashPlainMatch[1].toLowerCase().trim();
        value = dashPlainMatch[2].trim();
      } else {
        const plainMatch = text.match(PLAIN_BULLET_RE);
        if (plainMatch) {
          key = plainMatch[1].toLowerCase().trim();
          value = plainMatch[2].trim();
          result.warnings.push({
            code: 'BULLET_FORMAT',
            message: `Metadata field "${plainMatch[1]}" uses "* Key:" format instead of "- **Key**:". This may render poorly in some markdown viewers.`,
            line: token.line,
          });
        }
      }
    }

    if (!key || !value) continue;

    switch (key) {
      case 'date': result.date = value; break;
      case 'iteration': {
        const n = parseInt(value, 10);
        if (!isNaN(n)) result.iteration = n;
        break;
      }
      case 'status': {
        result.status = value;
        // INTENTIONALLY strict: do NOT add prefix-match tolerance here.
        // Even a "short" annotation like "Accepted (updated)" pollutes the status
        // taxonomy and sends the wrong signal — that ad-hoc annotations in the
        // status field are acceptable. The field encodes workflow state only.
        // The right fix is ADR-0014's D7 Socratic handler, which detects annotated
        // values and guides models toward structured alternatives (**Awaiting**:,
        // **Scope Remaining**:, etc.) instead of silently accepting them.
        // See: seed-2026-03-18-case-studies-on-models-experience-with-extension-feedback-ho.md
        if (!KNOWN_STATUS_VALUES.includes(value)) {
          result.warnings.push({
            code: 'UNKNOWN_STATUS',
            message: `ADR status "${value}" is not a recognized value. Known statuses: ${KNOWN_STATUS_VALUES.join(', ')}.`,
            line: token.line,
          });
        }
        break;
      }
      case 'deciders': {
        result.deciders = value.split(',').map(s => s.trim()).filter(Boolean);
        break;
      }
      case 'scope remaining': {
        result.scopeRemaining = value;
        break;
      }
      case 'awaiting': {
        result.awaiting = value;
        const dslMatch = value.match(AWAITING_DSL_RE);
        if (dslMatch) {
          result.awaitingCondition = { adr: dslMatch[1], predicate: dslMatch[2].trim() };
        }
        break;
      }
    }
  }

  if (!result.status) {
    result.warnings.push({
      code: 'MISSING_STATUS',
      message: 'ADR is missing a status field (Draft, Proposed, Accepted, Partially Implemented, Implemented, or Superseded).',
    });
    result.status = 'Draft'; // default fallback
  }

  if (result.status && requiresScopeRemaining(result.status) && !result.scopeRemaining) {
    result.warnings.push({
      code: 'MISSING_SCOPE_REMAINING',
      message: 'Status is "Partially Implemented" but the header is missing "- **Scope Remaining**: ...". Add this line directly below the Status line in the header metadata block. A quick fix is available.',
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sectionSlug(heading: string): string {
  // HQ ADR-0012: an explicit QST handle IS the default anchor — "qst-" +
  // lowercase(folded id) — checked first since it's a more specific match
  // than the generic nav-code slug below (and must win: the whole point of
  // an author-chosen id is a stable, predictable anchor, not one derived
  // from title wording that can drift).
  const handleMatch = heading.match(QST_HANDLE_RE) ?? heading.match(QST_HANDLE_TOLERANT_RE);
  if (handleMatch) {
    return `qst-${foldQstId(handleMatch[1]).toLowerCase()}`;
  }
  // Nav code headings: "QST: What is the scope?" → "qst-what-is-the-scope"
  // Falls back to the tolerant match so a glued colon ("QST:What is it") still
  // slugs as "qst-what-is-it" instead of merging into "qstwhat-is-it" — the
  // slug must stay canonical regardless of which form the heading used
  // (deep-link stability, ADR-0002), independent of the ParseWarning below.
  const navMatch = heading.match(NAV_CODE_HEADING_RE) ?? heading.match(NAV_CODE_HEADING_TOLERANT_RE);
  if (navMatch) {
    return slugify(`${navMatch[1].toLowerCase()}-${navMatch[2]}`);
  }
  return slugify(heading);
}

// ---------------------------------------------------------------------------
// ADR number extraction from filename
// ---------------------------------------------------------------------------

// ADR-0012: Accept any digit count (not just 4-digit) for variable-numbering projects.
const ADR_FILENAME_RE = /^(\d+)[-_]/;

export function extractAdrNumber(filePath: string): number {
  const basename = path.basename(filePath);
  const match = basename.match(ADR_FILENAME_RE);
  return match ? parseInt(match[1], 10) : 0;
}

/** True when the ADR filename uses a non-4-digit prefix (e.g., 001-foo.md or 1-foo.md). */
export function hasNonstandardNumbering(filePath: string): boolean {
  const basename = path.basename(filePath);
  const match = basename.match(ADR_FILENAME_RE);
  if (!match) return false;
  // Canonical form is exactly 4 digits
  return match[1].length !== 4;
}

// ---------------------------------------------------------------------------
// Section building
// ---------------------------------------------------------------------------

/** Look for <!-- @adr-anchor: slug --> on the line immediately after a heading */
const ANCHOR_COMMENT_RE = /^@adr-anchor:\s+(.+)$/;

/**
 * ADR-0018 (QST/ANS Substrate): exported so seedExtractor.ts can build a
 * section — including its navCode/heading-level checks — for a seed's
 * top-level (##) sections the same way parseAdr() does, not a narrower
 * reimplementation. See DEBRIEF (Lapidary 5, 2026-07-12): a seed extractor
 * that only descended into a fixed allowlist of top-level section names
 * (Thread/Brain Dump) silently dropped a correctly-formatted QST living
 * under any other heading (e.g. "## Lineage") — the same "one substrate,
 * two container kinds" principle this function already embodies for ADRs.
 */
export function buildSection(
  raw: RawSection,
  allSlugs: Set<string>,
  warnings: ParseWarning[],
  slugOccurrences: Map<string, number>,
): AdrSection {
  const heading = raw.heading.text;

  // HQ ADR-0012: explicit QST handle — "### QST-<ID>: <title>" — checked
  // before the generic nav-code regexes, which don't recognize it at all
  // (the ADR's own motivating incident: "QST-A:" silently dropped). Strict
  // (uppercase "QST") first; the lowercase/mixed-case fallback still
  // recovers the id but flags the case deviation, same posture as
  // NAV_CODE_HEADING_TOLERANT_RE below — never silently drop, never
  // silently normalize either.
  let handleMatch = heading.match(QST_HANDLE_RE);
  if (!handleMatch) {
    const tolerantHandle = heading.match(QST_HANDLE_TOLERANT_RE);
    if (tolerantHandle) {
      handleMatch = tolerantHandle;
      warnings.push({
        code: 'NONCANONICAL_NAV_CODE_HEADING',
        message: `Heading "${heading}" was recognized as a QST handle but "QST" isn't uppercase. Recognized anyway — no data lost — but the canonical form is what other tools (deep links, MCP) expect. SUGGESTED: "QST-${foldQstId(tolerantHandle[1])}: ${tolerantHandle[2].trim()}"`,
        line: raw.heading.line,
      })
    }
  }
  const qstId = handleMatch ? foldQstId(handleMatch[1]) : undefined;

  let navMatch: RegExpMatchArray | null = handleMatch
    ? (['', 'QST', handleMatch[2]] as unknown as RegExpMatchArray)
    : heading.match(NAV_CODE_HEADING_RE);

  // Tolerant fallback (ADR-0024): recover navCode for headings that only
  // deviate in case or colon spacing, so the question doesn't just disappear.
  // The deviation itself is still surfaced — accept liberally, warn always.
  // Skipped when the QST handle grammar already matched above.
  if (!navMatch) {
    const tolerant = heading.match(NAV_CODE_HEADING_TOLERANT_RE);
    if (tolerant) {
      navMatch = tolerant;
      warnings.push({
        code: 'NONCANONICAL_NAV_CODE_HEADING',
        message: `Heading "${heading}" was recognized as ${tolerant[1].toUpperCase()} but doesn't match the canonical "${tolerant[1].toUpperCase()}: text" form (case or colon spacing differs). Recognized anyway — no data lost — but the canonical form is what other tools (deep links, MCP) expect. SUGGESTED: "${tolerant[1].toUpperCase()}: ${tolerant[2].trim()}"`,
        line: raw.heading.line,
      });
    }
  }

  // Jérémie's ruling, dictated 2026-07-12 (Lapidary's dispatch, item 1):
  // a nav-code heading written at the wrong LEVEL ("## QST: ..." or
  // "#### QST: ...") should still parse — extractRawSections/buildSubsections
  // don't gate navCode matching on level, only on text — but the deviation
  // needs a LOUDER diagnostic than NONCANONICAL_NAV_CODE_HEADING's (that one
  // covers heading FORM: case/colon spacing; this is a different axis,
  // heading LEVEL) because a wrong-level QST is structurally riskier: at
  // level 2 it silently becomes its own top-level section boundary instead
  // of a child of whatever it was meant to nest under, which can reshape
  // the document's section tree, not just this one heading's recognition.
  // Mapped to DiagnosticSeverity.Warning (not Information) in extension.ts.
  if (navMatch && raw.heading.level !== 3) {
    warnings.push({
      code: 'NONCANONICAL_NAV_CODE_LEVEL',
      message: `Heading "${heading}" was recognized as ${navMatch[1].toUpperCase()} but is a level-${raw.heading.level} heading (${'#'.repeat(raw.heading.level)}) instead of the canonical level-3 (###). Recognized anyway — no data lost — but a wrong-level heading can silently reshape the surrounding section structure. SUGGESTED: "### ${heading}"`,
      line: raw.heading.line,
    });
  }

  let slug = sectionSlug(heading);
  let anchorOverride: string | undefined;

  // Check if the first non-blank token after the heading is an @adr-anchor comment
  const firstNonBlank = raw.body.find(t => t.kind !== 'blank');
  if (firstNonBlank?.kind === 'html_comment') {
    const anchorMatch = firstNonBlank.content.match(ANCHOR_COMMENT_RE);
    if (anchorMatch) {
      anchorOverride = anchorMatch[1].trim();
      slug = anchorOverride; // override slug with explicit anchor
    }
  }

  // Check for duplicate slugs. Disambiguate with an occurrence ORDINAL, not
  // the raw heading line number (write-adversary CATCH 6, Quarry 5): a line
  // number shifts on any edit above this section — including edits that
  // have nothing to do with either duplicate — so it made Question.id
  // unstable across ordinary edits for duplicate-heading-text questions,
  // undermining anything that resolves a question by id later (writeAnswer's
  // re-resolution fix, and ADR-0021's MCP write tools' "id is stable" claim).
  // An ordinal only changes if a NEW duplicate is inserted before this one —
  // the same, narrower threat model draftKey.ts's occurrenceOrdinal already
  // accepts.
  if (allSlugs.has(slug)) {
    const ordinal = (slugOccurrences.get(slug) ?? 0) + 1;
    slugOccurrences.set(slug, ordinal);
    const unique = `${slug}-${ordinal}`;
    warnings.push({
      code: 'DUPLICATE_SLUG',
      message: `Two sections resolve to the same slug "${slug}". Using "${unique}" (duplicate occurrence ${ordinal}, line ${raw.heading.line}).`,
      line: raw.heading.line,
    });
    slug = unique;
  }
  allSlugs.add(slug);

  // Build body text (re-join body tokens, preserving blank lines)
  const bodyLines = raw.body.map(t => t.raw);
  const body = bodyLines.join('\n').trim();

  const lineEnd = raw.body.length > 0
    ? raw.body[raw.body.length - 1].line
    : raw.heading.line;

  // Find nested subsections within the body (### and #### headings)
  const children = buildSubsections(raw.body, allSlugs, warnings, slugOccurrences);

  return {
    level: raw.heading.level,
    heading,
    navCode: navMatch ? navMatch[1].toUpperCase() as NavCode : undefined,
    navCodeText: navMatch ? navMatch[2].trim() : undefined,
    body,
    lineStart: raw.heading.line,
    lineEnd,
    slug,
    anchorOverride,
    qstId,
    children,
  };
}

/**
 * ADR-0018 (QST/ANS Substrate): exported so seedExtractor.ts can build the
 * same nav-code-aware section tree (with ADR-0024's heading tolerance) over
 * a seed's Brain Dump / Thread body tokens — container-agnostic reuse
 * rather than a parallel reimplementation.
 */
// Block-extent tail-swallow (Lapidary 5, 2026-07-13, grammar-seed +
// temp/0011 specimens): a subsection's body previously ran until the NEXT
// level>=3 heading — fine when one exists, but the LAST subsection in an
// enclosing section has no such heading to stop it, so its body ran all
// the way to the enclosing section's own end. For a seed's last QST, that
// swallowed the trailing "---" divider, the "**Model Response Request:**"
// checkbox block, and everything after — Jérémie: "the last question then
// parsed the dash-dash-dash that separates, with the checkbox... I think
// none of my questions were parsed accurately." Same conservative-clamp
// discipline as the h2-tolerance guard: block extent should stop at ANY
// structural boundary, heading or not. A bare thematic break ("---",
// "***", "___" — the template's own between-questions divider, never
// legitimately part of a question's own content) is exactly that boundary.
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

export function buildSubsections(
  bodyTokens: Token[],
  allSlugs: Set<string>,
  warnings: ParseWarning[],
  slugOccurrences: Map<string, number> = new Map(),
): AdrSection[] {
  const subsections: AdrSection[] = [];
  let current: { heading: ReturnType<typeof tokenize>[number] & { kind: 'heading' }; body: Token[] } | null = null;

  for (const token of bodyTokens) {
    if (token.kind === 'heading' && token.level >= 3) {
      if (current) {
        subsections.push(buildSection(
          { heading: current.heading, body: current.body },
          allSlugs,
          warnings,
          slugOccurrences,
        ));
      }
      current = { heading: token, body: [] };
      continue;
    }
    if (current && token.kind === 'body' && THEMATIC_BREAK_RE.test(token.text)) {
      subsections.push(buildSection(
        { heading: current.heading, body: current.body },
        allSlugs,
        warnings,
        slugOccurrences,
      ));
      current = null;
      continue;
    }
    if (current) {
      current.body.push(token);
    }
  }
  if (current) {
    subsections.push(buildSection({ heading: current.heading, body: current.body }, allSlugs, warnings, slugOccurrences));
  }

  return subsections;
}

// ---------------------------------------------------------------------------
// Question extraction
// ---------------------------------------------------------------------------

// Matches: **ANS:** (by Author) or **ANS:** (from Author)
const ANS_INLINE_RE = /^\*\*ANS:\*\*\s*(?:\((?:by|from)\s+([^)]+)\))?/;
// Matches: - Status: value
const STATUS_LINE_RE = /^-\s+Status:\s+(.+)$/;
// Matches: - Why asking: value
const WHY_ASKING_RE = /^-\s+Why asking:\s+(.+)$/;
// Matches: - Need: value
const NEED_RE = /^-\s+Need:\s+(.+)$/;
// Matches the legacy form (**My recommendation**: text, ADR-0002 Iteration 3),
// the protocol form (**Recommendation**: (by Author, date), ADR-0019), and
// the inline-attribution form (**Recommendation** (by Author): text —
// Lapidary's charter, 2026-07-12, temp/0021 Athanor specimen: attribution
// lands BETWEEN the bold marker and the colon, not after it. The strict
// "colon right after **Recommendation**" form silently dropped this —
// no field matched, the whole line and everything after it until ANS fell
// through to rawBody as plain prose, and the recommendation vanished as a
// structured field (not a visible-loss bug, a silent-misclassification one:
// same nemesis, different shape). Group 1 (optional): the inline
// attribution text, used as an explicit `author` — see recMatch handling.
const RECOMMENDATION_RE = /^\*\*(?:My recommendation|Recommendation)\*\*(?:\s*\((?:by|from)\s+([^)]+)\))?:\s*(.*)/;
// Protocol-form label lines carry only an attribution: "(by Fable 5, 2026-06-10)"
// or "(from Sonnet 4.6)". Captures author + optional date. Their body spans
// blank lines (paragraphs), unlike legacy single-paragraph prose.
const REC_ATTRIBUTION_RE = /^\((?:by|from)\s+([^,)]+?)(?:,\s*(.+))?\)\s*$/i;
// ADR-0019 QST-1: legacy `**My recommendation**:` blocks infer attribution
// from the ADR's Deciders line (single-AI ADRs dominate the legacy corpus).
const AI_AUTHOR_RE = /sonnet|opus|haiku|claude|gpt|gemini|llama|mistral|fable/i;

// Dash-bullet field form (Lapidary 5, 2026-07-13, temp/0015-database-schema.md
// specimen): "- Recommendation: text" or "- Recommendation (Author): text" —
// a plain dash-bullet field, not the canonical standalone "**Recommendation**:"
// block. Lapidary's diagnosis: the model regularized toward LOCAL
// consistency — three dash-bullet fields in a row (Status/Why asking/Need)
// invite a fourth, so the block-form Recommendation gets flattened into the
// same shape as its neighbors. Before this fix it matched neither
// RECOMMENDATION_RE nor any other field regex, so it fell through to raw
// prose: unstyled, unattributed (a real DMA/§1 attribution loss, not just a
// cosmetic one), and absent from `recommendations[]` entirely.
const RECOMMENDATION_BULLET_RE = /^-\s+Recommendation(?:\s*\(([^)]+)\))?:\s*(.*)/i;

// ADR-0012: the canonical placeholder — tolerated silently, no diagnostic.
const PLACEHOLDER_CANONICAL_RE = /^\[\s*fill\s+this\s+in[^\]]*\]$/i;
// D9.4 (live specimen, 2026-07-10, temp/0011-agent-sessions-json-linter-…):
// models sometimes emit a *different* stock placeholder token — inline
// "**ANS:** [unanswered]" instead of "**ANS:**" + newline + "[Fill this
// in]". Before this fix, none of these matched PLACEHOLDER_CANONICAL_RE, so
// the bracketed text became a real `answer` → isAnswered: true → the
// question silently vanished from the Open Questions panel *as done*
// (ADR-0024's founding bug in the opposite direction: there a question
// vanished as nonexistent, here it vanishes as answered). Whole-content-only
// (anchored ^...$) so a real answer that happens to reference something in
// brackets — "[see ADR-0014]" — is never misread as a placeholder; only a
// body that IS one of these stock tokens, and nothing else, counts.
// "awaiting" added 2026-07-12 (Quarry 5, ecosystem sweep, llm-orchestration-
// mcp/lyrical-mcp specimen — corpus zoo-005): "[Awaiting answer]", a fifth
// stock token. Confirms the lexicon design in ADR-0031: an enumerable list
// is always one incident behind, but naming the CLASS (a wait-state word,
// wrapped or bracketed) at least means adding a word is a one-line change,
// not a new regex.
const PLACEHOLDER_SYNONYM_RE = /^\[\s*(unanswered|to be answered|tbd|pending|todo|awaiting)[^\]]*\]$/i;
// Bug report (2026-07-12, Jérémie, temp/0048-mcp-support-rfc-connecting-
// external-tool-servers.md): a bare "[ ]" (or "[]") is a placeholder too —
// no stock word, just an empty box, and apparently a common one. A separate,
// tightly-scoped regex rather than widening PLACEHOLDER_SYNONYM_RE's group
// to match empty: that regex's trailing `[^\]]*` exists to tolerate extra
// words after the stock token, and letting the group itself match nothing
// would make `[^\]]*` swallow ANY bracketed text ("[see ADR-0014]") as a
// placeholder — exactly the false positive the whole-content-only anchoring
// on both regexes is designed to prevent.
const PLACEHOLDER_EMPTY_RE = /^\[\s*\]$/;

// D9.4 morphology #4 (Lapidary's charter, 2026-07-12, temp/0021-crew-
// architecture-and-staffing.md — Athanor 5 specimen): "_(pending)_" — no
// brackets at all, just italics wrapping a parenthesized stock word. Every
// prior D9.4 regex is bracket-anchored (PLACEHOLDER_CANONICAL_RE/_SYNONYM_RE/
// _EMPTY_RE all start `^\[`), so a bracket-free wrapped placeholder matched
// none of them, became a real `answer`, and the QST silently vanished as
// answered — even though "- Status: unanswered" was declared correctly
// right there in the same block (the declared-vs-derived conflict Lapidary's
// posture charter names directly). stripPlaceholderWrapper() peels ONE
// layer of italic (_..._ / *...*) and ONE layer of parens, in either
// combination, then the lexicon check runs ONLY on text that actually HAD
// at least one wrapper — never on bare unwrapped prose, so a real short
// answer like "Pending on budget approval" is never misread (no wrapper to
// strip → not eligible). Whole-content-only, same discipline as the
// bracket forms.
export const PLACEHOLDER_LEXICON_RE = /^(?:unanswered|to be answered|tbd|todo|pending|awaiting)\b.*$/i;

/**
 * Exported so the D9.4 normalizer handler (d9-4-nonstandard-fill-
 * placeholder.ts) can detect the SAME wrapped-placeholder morphology on its
 * own two-line "**ANS:**\n_(pending)_" form and offer a matching Quick Fix
 * — one placeholder-recognition rule, not two regexes drifting apart.
 */
export function stripPlaceholderWrapper(text: string): { inner: string; wrapped: boolean } {
  let s = text.trim();
  let wrapped = false;
  const italic = s.match(/^([*_])(.+)\1$/);
  if (italic) { s = italic[2].trim(); wrapped = true; }
  const paren = s.match(/^\((.+)\)$/);
  if (paren) { s = paren[1].trim(); wrapped = true; }
  return { inner: s, wrapped };
}

function inferAuthorFromDeciders(deciders: string[]): string | undefined {
  const aiName = deciders.find(d => AI_AUTHOR_RE.test(d));
  if (!aiName) return undefined;
  // "Sonnet 4.6 (1M)" → "Sonnet 4.6" — strip a trailing parenthetical annotation.
  return aiName.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Bold first sentence at the start of a recommendation's text — the skimmable "lean". */
function extractPick(text: string): string | undefined {
  const m = text.match(/^\*\*([^*]+)\*\*/);
  return m ? m[1].trim() : undefined;
}

// ADR-0012: Detect non-standard QST formats like "### QST-1:" or "**Your preference?**"
const NONSTANDARD_QST_HEADING_RE = /^QST-\d+:/i;
const NONSTANDARD_PREF_RE = /^\*\*[^*]*(?:preference|choice|option)\??\*\*/i;

function detectNonstandardQstFormat(tokens: ReturnType<typeof tokenize>): boolean {
  for (const token of tokens) {
    if (token.kind === 'heading' && token.level === 3) {
      if (NONSTANDARD_QST_HEADING_RE.test(token.text)) return true;
    }
    if (token.kind === 'body') {
      const trimmed = token.text.trim();
      if (NONSTANDARD_PREF_RE.test(trimmed)) return true;
    }
  }
  return false;
}

/**
 * ADR-0018 (QST/ANS Substrate): exported so seedExtractor.ts can extract
 * QST/ANS fields from a seed-embedded question the same way an ADR's
 * question is parsed — one field parser, two container kinds. `adrNumber`/
 * `adrPath` are seed-parlance-agnostic in practice (a source number and a
 * source path); seeds pass 0 and their own file path. `warnings` is
 * optional so existing/seed callers that don't yet thread a warnings array
 * through aren't forced to (ADR-0016-style: a real gap, not silently
 * assumed away — see the D9.4 fix note below).
 */
export function extractQuestion(
  section: AdrSection,
  adrNumber: number,
  adrPath: string,
  deciders: string[],
  warnings?: ParseWarning[],
): Question {
  const lines = section.body.split('\n');
  let statusText = 'unanswered';
  let whyAsking: string | undefined;
  let need: string | undefined;
  let recommendation: string | undefined;
  let answer: QuestionAnswer | undefined;

  let inAnswer = false;
  let inRecommendation = false;
  // ADR-0019 interim bridge: protocol-form blocks span blank lines; legacy
  // blocks end at the first blank line (preserving ADR-0010 behavior).
  let recProtocolForm = false;
  // pastRecommendation: true once we have seen AND exited a recommendation block.
  // Lines before recommendation → rawBody (context/grammar/options).
  // Lines after recommendation → rawBodyPost (orphaned closing remarks).
  let pastRecommendation = false;
  // Multi-line field continuation: LLMs often word-wrap field values at ~80 chars.
  // A continuation line starts with whitespace (2-space indent) and is not a new
  // bullet field or block element. Join with ' ' (space) since it's word-wrapping.
  let inWhyAsking = false;
  let inNeed = false;
  const answerLines: string[] = [];
  const recommendationLines: string[] = [];
  // ADR-0019: index into recommendationLines where each new
  // **Recommendation**:/**My recommendation**: block starts, so the flat
  // array can be re-split into per-block Recommendation objects.
  const recommendationBlockStarts: number[] = [];
  // Parallel to recommendationBlockStarts: whether that block used the
  // protocol form (attribution-only first line), the marker's source line,
  // and an inline attribution captured directly off the marker line itself
  // (see inlineAttribution note at RECOMMENDATION_RE).
  const recommendationBlockMeta: { protocolForm: boolean; line: number; inlineAttribution?: string }[] = [];
  const rawBodyLinesPre: string[] = [];
  const rawBodyLinesPost: string[] = [];
  let answerAuthor: string | undefined;
  let answerLine: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const absLine = section.lineStart + i + 1;

    if (inAnswer) {
      answerLines.push(lines[i]);
      continue;
    }

    // Multi-line field continuation: an indented line (starts with whitespace)
    // that is not blank, not a new bullet field, and not a block element.
    const isContinuation = /^\s+\S/.test(lines[i]) && line !== ''
      && !/^-\s+/.test(line) && !/^\*\*/.test(line);

    if (inWhyAsking) {
      if (isContinuation) { whyAsking = (whyAsking ?? '') + ' ' + line; continue; }
      inWhyAsking = false; // fall through to process this line normally
    }
    if (inNeed) {
      if (isContinuation) { need = (need ?? '') + ' ' + line; continue; }
      inNeed = false; // fall through
    }

    const statusMatch = line.match(STATUS_LINE_RE);
    // ADR-0012: trim to handle "- Status:  answered " with trailing/leading spaces
    if (statusMatch) { statusText = statusMatch[1].trim(); inRecommendation = false; inWhyAsking = false; inNeed = false; continue; }

    const whyMatch = line.match(WHY_ASKING_RE);
    if (whyMatch) { whyAsking = whyMatch[1].trim(); inRecommendation = false; inWhyAsking = true; inNeed = false; continue; }

    const needMatch = line.match(NEED_RE);
    if (needMatch) { need = needMatch[1].trim(); inRecommendation = false; inNeed = true; inWhyAsking = false; continue; }

    // Recommendation: starts with **My recommendation**: and may span multiple lines
    const recMatch = line.match(RECOMMENDATION_RE);
    if (recMatch) {
      // A second **Recommendation**: label lands here too — stacked blocks
      // (multiple models on one QST) accumulate into a single field until
      // ADR-0019's multi-recommendation model replaces this bridge.
      // Each marker also opens a new block boundary (see recommendations[] below).
      inRecommendation = true;
      recommendationBlockStarts.push(recommendationLines.length);
      const inlineAttribution = recMatch[1]?.trim();
      const firstLine = recMatch[2].trim();
      recProtocolForm = REC_ATTRIBUTION_RE.test(firstLine);
      recommendationBlockMeta.push({ protocolForm: recProtocolForm, line: absLine, inlineAttribution });
      if (firstLine) recommendationLines.push(firstLine);
      continue;
    }

    // Dash-bullet field form fallback (temp/0015 specimen): tolerate,
    // extract correctly (attribution included), warn — never silently drop
    // the structure the way the pre-fix behavior did (fell through to raw
    // prose, no attribution, absent from recommendations[] entirely).
    const recBulletMatch = line.match(RECOMMENDATION_BULLET_RE);
    if (recBulletMatch) {
      inRecommendation = true;
      recommendationBlockStarts.push(recommendationLines.length);
      const inlineAttribution = recBulletMatch[1]?.trim();
      const firstLine = recBulletMatch[2].trim();
      recProtocolForm = false; // dash-bullet form is always single-field, never multi-paragraph
      recommendationBlockMeta.push({ protocolForm: false, line: absLine, inlineAttribution });
      if (firstLine) recommendationLines.push(firstLine);
      if (warnings) {
        const suggestedMarker = inlineAttribution ? `**Recommendation** (by ${inlineAttribution}):` : '**Recommendation**:';
        // Recommendation text can run long — the diagnostic names the FORM
        // problem and shows the canonical marker to rewrite to, not a
        // full echo of the (potentially multi-hundred-word) recommendation
        // text itself.
        warnings.push({
          code: 'NONSTANDARD_RECOMMENDATION_FORM',
          message: `A Recommendation was found written as a "- Recommendation:" dash-bullet field, not the canonical standalone block. Recognized anyway — no data lost, attribution ${inlineAttribution ? `("${inlineAttribution}") ` : ''}included — but this form doesn't render with the recommendation's attribution styling, and it's an easy shape to regularize into by accident next to Status/Why asking/Need. SUGGESTED: rewrite this line as its own block starting with "${suggestedMarker}" rather than a dash-bullet field.`,
          line: absLine,
        });
      }
      continue;
    }

    // Continue collecting recommendation lines until hitting a new bold-key block,
    // the ANS block, or a blank line followed by a heading-like continuation.
    // ADR-0010: Fix greediness — stop at "**Caveat**:", "**Edge case**:", etc.
    if (inRecommendation) {
      if (line === '') {
        // Protocol-form bodies are multi-paragraph: keep collecting across
        // blank lines until ANS / a new bold-key block / the QST's end.
        if (recProtocolForm) { recommendationLines.push(''); continue; }
        inRecommendation = false; pastRecommendation = true; continue;
      }
      // Stop at any new **Key**: block that isn't the ANS marker
      if (/^\*\*[A-Z][^*]+\*\*:/.test(line) && !/^\*\*ANS:\*\*/.test(line) && !/^\*\*My recommendation\*\*:/.test(line)) {
        inRecommendation = false; pastRecommendation = true;
        /* fall through — process this line normally */
      } else if (/^\*\*ANS:\*\*/.test(line)) {
        inRecommendation = false; pastRecommendation = true; /* fall through */
      } else {
        recommendationLines.push(line);
        continue;
      }
    }

    const ansMatch = line.match(ANS_INLINE_RE);
    if (ansMatch) {
      inAnswer = true;
      answerAuthor = ansMatch[1]?.trim();
      answerLine = absLine;
      // Collect any text on the same line after the ANS marker
      const afterMarker = line.replace(ANS_INLINE_RE, '').trim();
      if (afterMarker) answerLines.push(afterMarker);
      continue;
    }

    // Every line that didn't match a recognized field: route by position
    if (pastRecommendation) {
      rawBodyLinesPost.push(lines[i]);
    } else {
      rawBodyLinesPre.push(lines[i]);
    }
  }

  // Trim leading/trailing blank lines from both body sections
  const trimBlanks = (arr: string[]) => {
    while (arr.length > 0 && arr[0].trim() === '') arr.shift()
    while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop()
  }
  trimBlanks(rawBodyLinesPre)
  trimBlanks(rawBodyLinesPost)
  // Hard-wrap robustness (Lapidary 5, 2026-07-13 reframe): rawBody/
  // rawBodyPost is typically the option bullets (A/B/C...) and gets handed
  // to the webview's markdown renderer as-is. A hard-wrapped continuation
  // line inside a bullet has no marker of its own, so the renderer's
  // line-based list detection can't tell it apart from a new paragraph —
  // the exact "Option B's text bleeding out of its bullet" screenshot.
  // Rejoining wrapped list items HERE, at extraction time, means every
  // downstream consumer (panel, MCP, future ones) sees already-normalized
  // markdown, not a renderer-specific patch.
  const rawBody = rawBodyLinesPre.length > 0 ? unwrapListItems(rawBodyLinesPre).join('\n') : undefined
  const rawBodyPost = rawBodyLinesPost.length > 0 ? unwrapListItems(rawBodyLinesPost).join('\n') : undefined

  if (answerLines.length > 0) {
    // Strip trailing horizontal rules and blank lines (--- separators between sections
    // are included in the section body and leak into the answer text)
    while (answerLines.length > 0) {
      const last = answerLines[answerLines.length - 1].trim();
      if (last === '---' || last === '') answerLines.pop();
      else break;
    }
    const answerText = answerLines.join('\n').trim();
    // ADR-0012: Tolerant placeholder matching — treat "[Fill this in]" variants as no-answer.
    const isCanonicalPlaceholder = PLACEHOLDER_CANONICAL_RE.test(answerText);
    // D9.4: a non-canonical stock token ("[unanswered]" etc.) is ALSO not a
    // real answer, but — unlike the canonical form — it's a deviation worth
    // surfacing: the model structured the QST correctly, it just reached
    // for the wrong bracketed word. Never silent (Postel + DMA).
    const isSynonymPlaceholder = !isCanonicalPlaceholder &&
      (PLACEHOLDER_SYNONYM_RE.test(answerText) || PLACEHOLDER_EMPTY_RE.test(answerText));
    // D9.4 morphology #4: bracket-free, italic/paren-wrapped stock words
    // ("_(pending)_", "(pending)", "*(TBD)*", "_todo_") — see
    // PLACEHOLDER_LEXICON_RE/stripPlaceholderWrapper() above.
    const strippedAnswer = stripPlaceholderWrapper(answerText);
    const isWrappedPlaceholder = !isCanonicalPlaceholder && !isSynonymPlaceholder &&
      strippedAnswer.wrapped && PLACEHOLDER_LEXICON_RE.test(strippedAnswer.inner);
    if ((isSynonymPlaceholder || isWrappedPlaceholder) && warnings) {
      warnings.push({
        code: 'NONSTANDARD_FILL_PLACEHOLDER',
        message: `The QST heading and structure here are correct — the placeholder text just isn't the canonical one. "${answerText}" was recognized as an unanswered placeholder (not a real answer), but the canonical form is "[Fill this in]" on its own line after "**ANS:**". SUGGESTED: **ANS:**\n[Fill this in]`,
        line: answerLine,
      });
    }
    if (answerText && !isCanonicalPlaceholder && !isSynonymPlaceholder && !isWrappedPlaceholder) {
      answer = { text: answerText, author: answerAuthor, line: answerLine! };
    }
  }

  // ADR-0012: Case-insensitive, trimmed comparison — human-typed values like "Answered" should work.
  const isAnswered = statusText.toLowerCase().trim() === 'answered' || !!answer;

  if (recommendationLines.length > 0) {
    // Hard-wrap robustness: join wrapped continuation lines within each
    // paragraph, preserving genuine blank-line paragraph breaks — see
    // unwrapParagraphs() and the matching rawBody fix above.
    recommendation = unwrapParagraphs(recommendationLines).join('\n').trim() || undefined;
  }

  let recommendations: Recommendation[] | undefined;
  if (recommendationBlockStarts.length > 0) {
    const bounds = [...recommendationBlockStarts, recommendationLines.length];
    const blocks: Recommendation[] = [];
    for (let i = 0; i < recommendationBlockStarts.length; i++) {
      const meta = recommendationBlockMeta[i];
      const rawLines = recommendationLines.slice(bounds[i], bounds[i + 1]);

      let author: string | undefined;
      let authorInferred: boolean | undefined;
      let date: string | undefined;
      let bodyLines = rawLines;

      if (meta.protocolForm) {
        const attrMatch = (rawLines[0] ?? '').match(REC_ATTRIBUTION_RE);
        if (attrMatch) {
          author = attrMatch[1].trim();
          date = attrMatch[2]?.trim();
        }
        bodyLines = rawLines.slice(1);
      } else if (meta.inlineAttribution) {
        // Inline-attribution form: "**Recommendation** (by Athanor 5, Claude
        // Fable 5): text" — the parenthetical is "seat, model", not
        // "author, date" (REC_ATTRIBUTION_RE's split assumption), so it's
        // used whole as the author string rather than re-split. Explicit,
        // not inferred — authorInferred stays unset, same as protocolForm.
        author = meta.inlineAttribution;
      } else {
        author = inferAuthorFromDeciders(deciders);
        if (author !== undefined) authorInferred = true;
      }

      // Hard-wrap robustness: same paragraph-join as the legacy
      // `recommendation` field above, applied per-block.
      const text = unwrapParagraphs(bodyLines).join('\n').trim();
      if (!text) continue;

      blocks.push({
        author,
        authorInferred,
        date,
        text,
        pick: extractPick(text),
        line: meta.line,
      });
    }
    if (blocks.length > 0) recommendations = blocks;
  }

  return {
    id: `adr-${String(adrNumber).padStart(4, '0')}-${section.slug}`,
    slug: section.slug,
    text: section.navCodeText || section.heading,
    statusText,
    isAnswered,
    whyAsking,
    need,
    recommendation,
    recommendations,
    rawBody,
    rawBodyPost,
    answer,
    adrNumber,
    adrPath,
    lineStart: section.lineStart,
    qstId: section.qstId,
  };
}

// ---------------------------------------------------------------------------
// Inline nav code extraction
// ---------------------------------------------------------------------------

// Matches inline **NOT:** or **ANS:** etc.
const INLINE_NAV_RE = /\*\*(QST|ANS|COD|API|FIL|DOC|NOT):\*\*\s*(?:\((?:by|from)\s+([^)]+)\))?\s*(.*)/;

function extractInlineCodes(sections: AdrSection[]): InlineNavCode[] {
  const found: InlineNavCode[] = [];

  function scanSection(section: AdrSection): void {
    const lines = section.body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(INLINE_NAV_RE);
      if (m) {
        found.push({
          code: m[1] as NavCode,
          text: m[3]?.trim() || '',
          author: m[2]?.trim(),
          line: section.lineStart + i + 1,
          sectionSlug: section.slug,
        });
      }
    }
    for (const child of section.children) {
      scanSection(child);
    }
  }

  for (const section of sections) {
    scanSection(section);
  }

  return found;
}

// ---------------------------------------------------------------------------
// Iteration extraction
// ---------------------------------------------------------------------------

// Matches: ### Iteration 2 (2026-03-02) or ### Iteration 1
const ITERATION_HEADING_RE = /^Iteration\s+(\d+)(?:\s+\(([^)]+)\))?$/i;
// Matches: - Human: ...  or  - AI (Sonnet 4.6):  ...
const ITERATION_FIELD_RE = /^-\s+(Human|AI[^:]*|Outcome):\s+(.+)$/;

function extractIterations(sections: AdrSection[]): AdrIteration[] {
  const iterationsSection = sections.find(s => s.heading === 'Iterations');
  if (!iterationsSection) return [];

  const iterations: AdrIteration[] = [];
  let current: Partial<AdrIteration> | null = null;

  for (const child of iterationsSection.children) {
    const iterMatch = child.heading.match(ITERATION_HEADING_RE);
    if (iterMatch) {
      if (current?.number !== undefined) iterations.push(current as AdrIteration);
      current = {
        number: parseInt(iterMatch[1], 10),
        date: iterMatch[2],
        lineStart: child.lineStart,
      };
      // Parse the body for Human/AI/Outcome fields
      const lines = child.body.split('\n');
      for (const line of lines) {
        const fieldMatch = line.trim().match(ITERATION_FIELD_RE);
        if (!fieldMatch) continue;
        const fieldKey = fieldMatch[1].toLowerCase();
        const fieldValue = fieldMatch[2].trim();
        if (fieldKey === 'human') current.human = fieldValue;
        else if (fieldKey.startsWith('ai')) {
          // Preserve model attribution: "AI (Sonnet 4.6):" → "(Sonnet 4.6): text"
          const suffix = fieldMatch[1].slice(2).trim(); // e.g., "(Sonnet 4.6)"
          current.ai = suffix ? `${suffix}: ${fieldValue}` : fieldValue;
        }
        else if (fieldKey === 'outcome') current.outcome = fieldValue;
      }
    }
  }

  if (current?.number !== undefined) iterations.push(current as AdrIteration);
  return iterations;
}

// ---------------------------------------------------------------------------
// Deep link generation
// ---------------------------------------------------------------------------

function buildDeepLinks(sections: AdrSection[], questions: Question[]): DeepLink[] {
  const links: DeepLink[] = [];

  function addSectionLinks(section: AdrSection): void {
    links.push({
      slug: section.slug,
      displayText: section.heading,
      lineNumber: section.lineStart,
      type: 'section',
    });
    for (const child of section.children) addSectionLinks(child);
  }

  for (const section of sections) addSectionLinks(section);

  for (const q of questions) {
    links.push({
      slug: q.slug,
      displayText: q.text,
      lineNumber: q.lineStart,
      type: 'question',
    });
    if (q.answer) {
      links.push({
        slug: `${q.slug}-answer`,
        displayText: `Answer to: ${q.text}`,
        lineNumber: q.answer.line,
        type: 'answer',
      });
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface ParseOptions {
  /** Project namespace for cross-project deep links */
  namespace?: string;
}

/**
 * Parse an ADR file from its raw content and absolute path.
 * Returns a fully typed AdrFile regardless of format variant.
 * Never throws — parse errors are surfaced as ParseWarning entries.
 */
export function parseAdr(content: string, filePath: string, options: ParseOptions = {}): AdrFile {
  const checksum = crypto.createHash('sha1').update(content).digest('hex');
  const parsedAt = Date.now();
  const warnings: ParseWarning[] = [];
  const allSlugs = new Set<string>();

  // Stage 1: tokenize
  const tokens = tokenize(content);

  // Detect format
  const { format } = detectFormat(tokens);

  // Extract raw sections from the token stream
  const { title, titleLine, sections: rawSections } = extractRawSections(tokens);

  if (!title) {
    warnings.push({ code: 'MISSING_TITLE', message: 'ADR is missing a level-1 heading (# Title).' });
  }

  // Extract metadata from the preamble (tokens before the first ## section)
  // These appear between the # Title heading and the ## Quick Reference or first ## section
  const preambleTokens = tokens.filter(t => t.line > (titleLine ?? 0) && (
    rawSections.length === 0 || t.line < rawSections[0].heading.line
  ));
  const metadata = extractMetadata(preambleTokens);
  warnings.push(...metadata.warnings);

  // Build typed sections
  const slugOccurrences = new Map<string, number>();
  const sections: AdrSection[] = rawSections.map(raw =>
    buildSection(raw, allSlugs, warnings, slugOccurrences)
  );

  // Extract questions (QST sections + their children)
  const adrNumber = extractAdrNumber(filePath);
  const questions: Question[] = [];

  function collectQuestions(sectionList: AdrSection[]): void {
    for (const s of sectionList) {
      if (s.navCode === 'QST') {
        questions.push({ ...extractQuestion(s, adrNumber, filePath, metadata.deciders, warnings), sourceKind: 'adr' });
      }
      collectQuestions(s.children);
    }
  }
  collectQuestions(sections);

  // Extract inline nav codes (ANS, NOT that appear inline, not as headings)
  const inlineCodes = extractInlineCodes(sections);

  // Extract iteration history
  const iterations = extractIterations(sections);

  // Build deep link index
  const deepLinks = buildDeepLinks(sections, questions);

  // ADR-0012: Warn when ADR filename uses non-4-digit prefix (e.g., 001-foo.md)
  if (hasNonstandardNumbering(filePath)) {
    warnings.push({
      code: 'NONSTANDARD_NUMBERING',
      message: `ADR filename "${path.basename(filePath)}" uses a non-4-digit number prefix. The canonical format is 4-digit zero-padded (0001). Displayed as ADR-${String(adrNumber).padStart(4, '0')} — no data loss.`,
    });
  }

  // ADR-0012: Warn when non-standard QST format is detected (### QST-N: or **Preference?**)
  const hasNonstandardQst = detectNonstandardQstFormat(tokens);
  if (hasNonstandardQst) {
    warnings.push({
      code: 'NONSTANDARD_QST_FORMAT',
      message: 'Some question blocks appear to use a non-standard format (e.g., ### QST-1: or **Your preference?**). The extension only extracts questions using the "### QST: text / - Status: unanswered" format. See the collab-adr-lean template for the canonical structure.',
    });
  }

  // Seeds (title starts with "SEED:") are brain dumps, not decisions.
  // They don't require a Status field — remove the MISSING_STATUS warning.
  const isSeed = (title ?? '').toUpperCase().startsWith('SEED:');
  const finalWarnings = isSeed
    ? warnings.filter(w => w.code !== 'MISSING_STATUS')
    : warnings;

  return {
    path: filePath,
    number: adrNumber,
    title: title ?? path.basename(filePath, '.md'),
    isSeed,
    date: metadata.date,
    iteration: metadata.iteration,
    status: metadata.status ?? 'Draft',
    scopeRemaining: metadata.scopeRemaining,
    awaiting: metadata.awaiting,
    awaitingCondition: metadata.awaitingCondition,
    deciders: metadata.deciders,
    format,
    sections,
    questions,
    inlineCodes,
    iterations,
    namespace: options.namespace,
    deepLinks,
    checksum,
    parseWarnings: finalWarnings,
    parsedAt,
  };
}
