/**
 * Context (continues 2026-10-10-probe-etude-dechrome-tour-all-caught-up.ts):
 * the raw parser confirmed both questions are real/unanswered with correct
 * aliasSlug. This probe runs the FULL live path — a real CompositeIndex
 * scanned from the real workspace root, then findTour + resolveTourEntries,
 * exactly as OpenQuestionsPanel.buildTourQuestions does — to see whether
 * the tour itself resolves, since `src/webview/commandArgs.ts`'s own doc
 * comment names "tour that cannot resolve -> renders All caught up" as a
 * known failure shape.
 */
import { CompositeIndex } from '../../src/index/compositeIndex'
import { createRepositoryContextAdapter } from '../../src/index/repositoryContextAdapter'
import { resolveTourEntries } from '../../src/index/tourIndex'

async function main() {
  const workspaceRoot = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude'
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })

  console.log('all tours found:', composite.allTours().map(t => t.tour.slug))

  const slug = '2026-10-10-dechrome-residue'
  const found = composite.findTour(slug)
  console.log('findTour result:', found ? 'FOUND' : 'NOT FOUND')
  if (!found) return

  const resolved = resolveTourEntries(found.tour, createRepositoryContextAdapter(composite))
  for (const entry of resolved) {
    console.log('---')
    console.log('ref:', entry.ref)
    console.log('resolution.kind:', entry.resolution.kind)
    if (entry.resolution.kind === 'error') console.log('error:', entry.resolution.message)
    if (entry.resolution.kind === 'question') console.log('question text:', entry.resolution.question.text, '| isAnswered:', entry.resolution.question.isAnswered)
  }
}

main()

// OUTCOME (2026-10-10): tour found, both entries resolve to kind:'question'
// with isAnswered:false, matching the real content exactly. The full live
// path — a FRESH CompositeIndex.fromWorkspace scan, the same findTour +
// resolveTourEntries buildTourQuestions uses — is completely correct
// against the real repo right now. Combined with the sibling probe
// (parser-level check, also clean), this rules out a parser or resolver
// bug. The tour file's only git commit (328a9c0, 2026-10-09T23:48:25Z)
// landed ~55 minutes before both founder Reports (00:43Z), so the file
// was already complete and committed when he clicked — not a mid-
// assembly race. Tour files DO have full FileSystemWatcher parity
// (rootWatcherLifecycle.ts, onDidCreate/Change/Delete on tours/*.tour.json
// — Riddle's ruling, "tours get full watcher parity"), so this isn't a
// glob-coverage gap either. Most likely explanation, not confirmed live:
// a one-off watcher-miss on a git-committed (not editor-saved) new tour
// file, of the kind VS Code's FileSystemWatcher is documented to
// occasionally drop — exactly the class a window reload or manual
// Refresh would clear. Reported to the founder with the practical
// remedy and a question about recurrence, rather than guess-fixing a
// path that already tests clean end to end.
