/**
 * Commit-confirmation artifact classification.
 *
 * Jérémie's report (2026-07-12, second time raising the same nit): the
 * "Committed N ADR file(s)" notification calls every staged path an "ADR"
 * — including docs/adr/.working/drafts.json, which is draft-answer state,
 * not a decision record. The message needs to say what's actually true.
 *
 * Design for extension (rhymes with ADR-0029 QST-E's answered design: an
 * open, growing set of artifact classes, not a fixed enum) — CLASSES is an
 * ordered list, not an if/else chain. A future class (e.g. ADR-0027's
 * queue artifacts) is one new entry, not a rewrite of the counting or
 * formatting logic. Order matters: more specific classes (draft state,
 * nested under .working/) must be checked before the general ADR-filename
 * pattern, so a numbered-looking file inside .working/ is never misfiled
 * as an ADR.
 */

function pathSegments(filePath: string): string[] {
  return filePath.replace(/\\/g, '/').split('/')
}

function basename(filePath: string): string {
  const segments = pathSegments(filePath)
  return segments[segments.length - 1] ?? ''
}

/**
 * Lapidary's 2026-07-30 founder-escalation dispatch ("the commit sweeps
 * .working/ state it already knows — drafts AND errors.jsonl — needs to be
 * more regular"): errors.jsonl used to fall under the same generic "draft
 * state" label as drafts.json, which reads as a mislabel — a harvested
 * error record is not a draft answer. Split into its own class.
 */
function isErrorLedgerFile(filePath: string): boolean {
  return pathSegments(filePath).includes('.working') && basename(filePath) === 'errors.jsonl'
}

function isDraftStateFile(filePath: string): boolean {
  return pathSegments(filePath).includes('.working') && !isErrorLedgerFile(filePath)
}

function isSeedFile(filePath: string): boolean {
  const base = basename(filePath)
  return base.startsWith('seed-') && base.endsWith('.md')
}

function isAdrFile(filePath: string): boolean {
  const base = basename(filePath)
  // Mirrors AdrIndex.indexDirectory's own filter (ADR-0012: any digit count, not just 4).
  return /^\d+[-_].+\.md$/.test(base) && !base.startsWith('seed-')
}

interface ArtifactClassDef {
  id: string
  test: (filePath: string) => boolean
  /** Given the count in this class, the phrase to show — a constant phrase (draft state) or a pluralized count. */
  label: (count: number) => string
}

const pluralize = (count: number, singular: string, plural = singular + 's'): string =>
  `${count} ${count === 1 ? singular : plural}`

const ARTIFACT_CLASSES: ArtifactClassDef[] = [
  { id: 'error-ledger', test: isErrorLedgerFile, label: () => 'error ledger' },
  { id: 'draft', test: isDraftStateFile, label: () => 'draft state' },
  { id: 'seed', test: isSeedFile, label: n => pluralize(n, 'seed') },
  { id: 'adr', test: isAdrFile, label: n => pluralize(n, 'ADR') },
]

/**
 * "Committed: 2 ADRs, 1 seed, draft state" — omits any class with zero
 * members, groups anything unrecognized under "N other file(s)" rather
 * than silently mislabeling it as one of the known classes.
 */
export function summarizeCommittedArtifacts(filePaths: string[]): string {
  const counts = new Map<string, number>()
  let otherCount = 0

  for (const filePath of filePaths) {
    const matched = ARTIFACT_CLASSES.find(cls => cls.test(filePath))
    if (matched) {
      counts.set(matched.id, (counts.get(matched.id) ?? 0) + 1)
    } else {
      otherCount++
    }
  }

  const parts: string[] = []
  for (const cls of ARTIFACT_CLASSES) {
    const count = counts.get(cls.id) ?? 0
    if (count > 0) parts.push(cls.label(count))
  }
  if (otherCount > 0) parts.push(pluralize(otherCount, 'other file'))

  return parts.join(', ')
}
