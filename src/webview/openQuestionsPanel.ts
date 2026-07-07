/**
 * Open Questions Panel — Forma 2
 *
 * A webview panel showing all unanswered questions across the ADR index,
 * one at a time, with an inline answer field.
 *
 * The user types their answer and hits Answer → (or Cmd+Enter).
 * The panel writes the answer back to the ADR file via WorkspaceEdit,
 * updates the - Status: line, and advances to the next question.
 *
 * Philosophy (from ADR-0001): "The extension should let you answer
 * questions without having to open the file." This is that.
 */

import * as vscode from 'vscode'
import { execSync } from 'child_process'
import * as crypto from 'crypto'
import * as path from 'path'
import * as os from 'os'
import type { AdrIndex } from '../index/adrIndex'
import type { Recommendation } from '../parser/types'
import { parseAdr } from '../parser/extractor'
import { bodyMaxWidthCss } from './panelSettings'
import { DraftStore } from '../drafts/draftStore'
import { computeDraftKey, computeOccurrenceOrdinals, computeOccurrenceCounts } from '../drafts/draftKey'

// ---------------------------------------------------------------------------
// Serialized question shape (what we send to the webview)
// ---------------------------------------------------------------------------

interface WebviewQuestion {
  id: string
  text: string
  whyAsking?: string
  need?: string
  recommendation?: string
  /** ADR-0019: recommendation blocks, source order, each attributed. */
  recommendations?: Recommendation[]
  body?: string
  bodyPost?: string
  /** ADR-0010: Markdown content of sections before ## Questions (Human Context + AI Interpretation) */
  adrContext?: string
  adrNumber: number
  adrTitle: string
  adrPath: string
  lineStart: number  // 1-indexed line of the ### QST: heading
  /** ADR-0023: adrNumber+textHash+ordinal — stable across line shifts. */
  draftKey: string
  /** ADR-0023 CATCH 3 guard: sibling count sharing this question's text-hash in the ADR right now. */
  totalOccurrences: number
  /** ADR-0023 drift fence: the ADR file's content checksum at render time. */
  fileChecksum: string
  /** ADR-0023: restored draft text, if a draft exists for this question's key. */
  draftText?: string
  /** ADR-0023: ISO timestamp the draft was last saved, for the "draft restored" indicator. */
  draftSavedAt?: string
}

// ---------------------------------------------------------------------------
// Messages webview → extension
// ---------------------------------------------------------------------------

type WebviewMessage =
  | {
      type: 'answer'
      questionId: string
      adrPath: string
      lineStart: number
      answerText: string
      authorName: string
      draftKey: string
      fileChecksum: string
      /** ADR-0023 drift fence: "Write anyway" — skip the checksum re-check. */
      force?: boolean
    }
  | { type: 'skip' }
  | { type: 'jumpTo'; adrPath: string; lineNumber: number }
  | { type: 'draft'; draftKey: string; adrPath: string; adrNumber: number; questionText: string; draftText: string; totalOccurrences: number }
  | { type: 'refreshRequest' }
  | { type: 'ready' }

// ---------------------------------------------------------------------------
// Panel class
// ---------------------------------------------------------------------------

export class OpenQuestionsPanel {
  private static instance: OpenQuestionsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []
  private readonly draftStore: DraftStore

  // ---------------------------------------------------------------------------

  static createOrShow(index: AdrIndex): void {
    if (OpenQuestionsPanel.instance) {
      OpenQuestionsPanel.instance.panel.reveal(vscode.ViewColumn.One)
      return
    }
    new OpenQuestionsPanel(index)
  }

  /** Jump the open panel to a specific question by ID. Call after createOrShow. */
  static navigateTo(questionId: string): void {
    // Post after a short delay to let the panel initialize if it was just opened
    setTimeout(() => {
      OpenQuestionsPanel.instance?.panel.webview.postMessage({ type: 'navigate', questionId })
    }, 150)
  }

  private constructor(private readonly index: AdrIndex) {
    OpenQuestionsPanel.instance = this

    // ADR-0023: docs/adr/.working/ — committed substrate, not a gitignored
    // sidecar (Jérémie's completist reversal). Owned by the ADR directory,
    // not the workspace root.
    const cfg = vscode.workspace.getConfiguration('adrManager')
    const adrDirRel = cfg.get<string>('adrDirectory', 'docs/adr')
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const workingDir = workspaceRoot
      ? path.join(workspaceRoot, adrDirRel, '.working')
      : path.join(os.tmpdir(), 'adr-drafts-no-workspace')
    this.draftStore = new DraftStore(workingDir)
    if (this.draftStore.quarantinedFiles.length > 0) {
      // CATCH 1 (write-adversary): a corrupt drafts.json/drafts-archive.json
      // was found and quarantined (renamed aside, never deleted) rather than
      // silently discarded. Surface it — recovery from the .bak mirror
      // happens automatically, but the human should know it happened.
      vscode.window.showWarningMessage(
        `ADR Manager: found and quarantined ${this.draftStore.quarantinedFiles.length} corrupt draft file(s); recovered from backup where possible. See ${this.draftStore.quarantinedFiles.join(', ')}.`,
      )
    }

    this.panel = vscode.window.createWebviewPanel(
      'adrOpenQuestions',
      'Open Questions',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.webview.html = getHtml(computeBodyMaxWidth())
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    )

    // Refresh when index changes (file edits, saves, etc.)
    const unsubscribe = index.onChange(() => this.sendQuestions())
    this.disposables.push({ dispose: unsubscribe })

    this.sendQuestions()
  }

  private sendQuestions(): void {
    const questions: WebviewQuestion[] = this.index.allAdrs().flatMap(adr => {
      const cleanTitle = adr.title.replace(/^ADR[-\s]*\d+[:\s\-]+/i, '').trim() || adr.title
      // ADR-0010: Collect context from sections before ## Questions for the collapsible context box.
      // Include: Human Context, AI Interpretation (and any other ## sections before Questions).
      const contextSections = adr.sections.filter(s => {
        const h = s.heading.toLowerCase()
        return h !== 'questions' && h !== 'quick reference' && h !== 'decision'
          && h !== 'action items' && h !== 'iterations' && h !== 'links'
          && h !== 'validation' && h !== 'supporting materials'
          && s.lineStart < (adr.sections.find(qs => qs.heading === 'Questions')?.lineStart ?? Infinity)
      })
      const adrContext = contextSections.length > 0
        ? contextSections.map(s => `## ${s.heading}\n\n${s.body}`).join('\n\n---\n\n').trim()
        : undefined

      // ADR-0023: occurrence ordinals/counts computed over ALL questions in
      // the file (not just unanswered ones) — the key must be stable
      // regardless of which questions have already been answered and
      // filtered out below.
      const ordinals = computeOccurrenceOrdinals(adr.questions.map(q => q.text))
      const totals = computeOccurrenceCounts(adr.questions.map(q => q.text))

      return adr.questions
        .map((q, idx) => ({ q, ordinal: ordinals[idx], total: totals[idx] }))
        .filter(({ q }) => !q.isAnswered)
        .map(({ q, ordinal, total }) => {
          const draftKey = computeDraftKey(String(adr.number), q.text, ordinal)
          // getIfMatching, not get: a stale key whose duplicate-text group
          // shape has shifted (write-adversary CATCH 3) must never silently
          // restore into the wrong question's answer box.
          const draft = this.draftStore.getIfMatching(draftKey, q.text, total)
          return {
            id: q.id,
            text: q.text,
            whyAsking: q.whyAsking,
            need: q.need,
            recommendation: q.recommendation,
            recommendations: q.recommendations,
            body: q.rawBody,
            bodyPost: q.rawBodyPost,
            adrContext,
            adrNumber: adr.number,
            adrTitle: cleanTitle,
            adrPath: adr.path,
            lineStart: q.lineStart,
            draftKey,
            totalOccurrences: total,
            fileChecksum: adr.checksum,
            draftText: draft?.draftText,
            draftSavedAt: draft?.updatedAt,
          }
        })
    })

    const cfg = vscode.workspace.getConfiguration('adrManager')
    const settingsName = cfg.get<string>('humanName', '')
    this.panel.webview.postMessage({
      type: 'questions',
      questions,
      // Priority: settings > git config > top name from ADR index
      gitAuthor: settingsName || getGitUserName() || extractHumanNames(this.index)[0],
      recommendationCollapseThreshold: cfg.get<number>('panel.recommendationCollapseThreshold', 0),
    })
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'answer': await this.writeAnswer(msg); break
      case 'skip': this.panel.webview.postMessage({ type: 'skip_ack' }); break
      case 'jumpTo': await this.openAtLine(msg.adrPath, msg.lineNumber); break
      case 'draft':
        // ADR-0023: debounced (~500ms) auto-save from the webview's textarea input.
        this.draftStore.save(
          msg.draftKey, msg.adrPath, msg.adrNumber, msg.questionText, msg.draftText,
          new Date().toISOString(), msg.totalOccurrences,
        )
        break
      case 'refreshRequest':
        // ADR-0023 drift fence, "Refresh" choice: force a re-parse so the
        // panel's next 'questions' push reflects the file as it is now.
        this.sendQuestions()
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Write answer back to the ADR file
  // ---------------------------------------------------------------------------

  private async writeAnswer(msg: {
    questionId: string
    adrPath: string
    lineStart: number
    answerText: string
    authorName: string
    draftKey: string
    fileChecksum: string
    force?: boolean
  }): Promise<void> {
    try {
      const uri = vscode.Uri.file(msg.adrPath)
      const doc = await vscode.workspace.openTextDocument(uri)
      const currentContent = doc.getText()

      // ADR-0023 drift fence: never write blind. If the file changed under
      // this in-flight answer, stop and let the human choose — the draft
      // (already auto-saved) is safe in all three consent paths.
      if (!msg.force) {
        const currentChecksum = crypto.createHash('sha1').update(currentContent).digest('hex')
        if (currentChecksum !== msg.fileChecksum) {
          this.panel.webview.postMessage({ type: 'driftDetected', questionId: msg.questionId })
          return
        }
      }

      // Re-resolve the question's CURRENT position by id rather than
      // trusting msg.lineStart, which was captured at render time and can be
      // stale — critical under `force` (the drift fence's checksum check is
      // skipped there entirely). Write-adversary finding (Quarry 5): a stale
      // line offset against shifted content can land the search window in a
      // DIFFERENT question's block, silently overwriting it — misattribution,
      // not just loss. Refuse (visible error) rather than guess when the
      // question can't be relocated, e.g. its heading text itself changed.
      const freshAdr = parseAdr(currentContent, msg.adrPath)
      const currentQuestion = freshAdr.questions.find(q => q.id === msg.questionId)
      if (!currentQuestion) {
        this.panel.webview.postMessage({
          type: 'error',
          message: `Could not relocate this question in ${msg.adrPath} — it may have been edited or removed. Please answer it manually.`,
        })
        return
      }

      const lines = currentContent.split('\n')
      const edit = new vscode.WorkspaceEdit()

      // Search window: from QST heading line (1-indexed → 0-indexed) forward
      const start = currentQuestion.lineStart - 1
      const end = Math.min(start + 40, lines.length)

      let statusLineIdx = -1
      let ansHeaderLineIdx = -1
      let fillLineIdx = -1

      for (let i = start; i < end; i++) {
        const trimmed = lines[i].trim()
        if (trimmed.startsWith('- Status:') && statusLineIdx === -1) statusLineIdx = i
        if (/^\*\*ANS:\*\*/.test(trimmed) && ansHeaderLineIdx === -1) ansHeaderLineIdx = i
        // ADR-0012: Tolerant matching — handle extra spaces and case variations like
        // "[ Fill this in ]", "[ Fill this in please ]", "[fill this in]".
        if (/^\[\s*fill\s+this\s+in[^\]]*\]$/i.test(trimmed) && ansHeaderLineIdx !== -1 && fillLineIdx === -1) fillLineIdx = i
        // Stop searching at the next QST heading
        if (i > start && trimmed.startsWith('### QST:')) break
      }

      // 1. Update status → answered
      if (statusLineIdx >= 0) {
        edit.replace(uri, lineRange(doc, statusLineIdx), '- Status: answered')
      }

      // 2. Update the **ANS:** author line
      if (ansHeaderLineIdx >= 0) {
        const author = msg.authorName.trim() || 'Human'
        edit.replace(uri, lineRange(doc, ansHeaderLineIdx), `**ANS:** (by ${author})`)
      }

      // 3. Replace [Fill this in] with the answer (or insert after ANS header)
      if (fillLineIdx >= 0) {
        edit.replace(uri, lineRange(doc, fillLineIdx), msg.answerText)
      } else if (ansHeaderLineIdx >= 0) {
        // No placeholder — insert after the ANS header line
        const pos = new vscode.Position(ansHeaderLineIdx + 1, 0)
        edit.insert(uri, pos, msg.answerText + '\n')
      } else {
        // Fallback: can't find where to insert — report error
        this.panel.webview.postMessage({
          type: 'error',
          message: `Could not find the ANS block near line ${currentQuestion.lineStart} in ${msg.adrPath}. Please answer this one manually.`,
        })
        return
      }

      await vscode.workspace.applyEdit(edit)
      await vscode.workspace.save(uri)

      // Bug fix (seed-2026-07-06-panel-submit-no-refresh-bug.md): don't rely
      // solely on the FileSystemWatcher round-trip for a write we just made
      // ourselves. The panel previously depended entirely on the async
      // watcher → indexFile → onChange → sendQuestions chain to notice its
      // own write; when that round-trip was slow or missed, the question
      // stayed visible ("brief blink then nothing") until an unrelated
      // manual editor save nudged the watcher. Reindexing synchronously here
      // makes the refresh immediate and deterministic; the watcher remains a
      // (now redundant, harmless) backup path for externally-made changes.
      this.index.indexFile(msg.adrPath)

      // ADR-0023: answer submitted is one atomic event — the draft is
      // promoted (archived, never deleted), not left dangling in the active set.
      this.draftStore.promote(msg.draftKey, new Date().toISOString())

      this.panel.webview.postMessage({ type: 'answered', questionId: msg.questionId })
    } catch (err) {
      this.panel.webview.postMessage({ type: 'error', message: String(err) })
    }
  }

  private async openAtLine(adrPath: string, lineNumber: number): Promise<void> {
    const uri = vscode.Uri.file(adrPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two, true)
    const pos = new vscode.Position(Math.max(0, lineNumber - 1), 0)
    editor.selection = new vscode.Selection(pos, pos)
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
  }

  private dispose(): void {
    OpenQuestionsPanel.instance = undefined
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
  }
}

// ---------------------------------------------------------------------------
// Panel body width (ADR-0010 answered QST)
// ---------------------------------------------------------------------------

function computeBodyMaxWidth(): string {
  const cfg = vscode.workspace.getConfiguration('adrManager')
  return bodyMaxWidthCss(cfg.get<string>('panel.bodyMaxWidth', '1100'))
}

// ---------------------------------------------------------------------------
// Author name helpers
// ---------------------------------------------------------------------------

/** Try to get the git user name from the workspace's git config. */
function getGitUserName(): string | undefined {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const result = execSync('git config user.name', {
      encoding: 'utf-8',
      cwd: workspaceRoot,
      timeout: 2000,
    }).trim()
    return result || undefined
  } catch {
    return undefined
  }
}

/**
 * Extract human author names from the ADR index, ranked by frequency.
 * Filters out AI model names (Sonnet, Opus, Haiku, Claude, GPT, Gemini, etc.)
 * so only human names appear in the suggestion list.
 */
function extractHumanNames(index: AdrIndex): string[] {
  const freq = new Map<string, number>()
  const bump = (name: string) => freq.set(name, (freq.get(name) ?? 0) + 1)

  const AI_NAME_RE = /sonnet|opus|haiku|claude|gpt|gemini|llama|mistral/i

  for (const adr of index.allAdrs()) {
    for (const d of adr.deciders) {
      if (!AI_NAME_RE.test(d)) bump(d)
    }
    for (const q of adr.questions) {
      if (q.answer?.author && !AI_NAME_RE.test(q.answer.author)) bump(q.answer.author)
    }
    for (const c of adr.inlineCodes) {
      if (c.author && !AI_NAME_RE.test(c.author)) bump(c.author)
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
}

// ---------------------------------------------------------------------------
// Utility: get the full range of a line in a document
// ---------------------------------------------------------------------------

function lineRange(doc: vscode.TextDocument, lineIdx: number): vscode.Range {
  const line = doc.lineAt(lineIdx)
  return line.range
}

// ---------------------------------------------------------------------------
// HTML / CSS / JS for the webview
// ---------------------------------------------------------------------------

function getHtml(bodyMaxWidth: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Open Questions</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  color:var(--vscode-foreground);
  background:var(--vscode-editor-background);
  padding:32px 24px;
}
#empty{
  display:none;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  height:60vh;
  opacity:.6;
  text-align:center;
  gap:12px;
}
#empty .icon{font-size:48px}
#card{max-width:${bodyMaxWidth};margin:0 auto}
.counter{
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  letter-spacing:.05em;
  text-transform:uppercase;
  margin-bottom:8px;
}
.progress{
  width:100%;height:3px;
  background:var(--vscode-scrollbarSlider-background);
  border-radius:2px;
  margin-bottom:28px;overflow:hidden;
}
.progress-fill{
  height:100%;
  background:var(--vscode-progressBar-background);
  border-radius:2px;
  transition:width .4s ease;
}
.adr-link{
  display:inline-flex;align-items:center;gap:6px;
  background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground);
  border-radius:4px;
  padding:3px 10px;
  font-size:11px;font-weight:600;
  cursor:pointer;
  margin-bottom:14px;
  border:none;
  font-family:var(--vscode-font-family);
}
.adr-link:hover{opacity:.8}
.qtext{
  font-size:20px;font-weight:600;
  line-height:1.4;
  margin-bottom:16px;
  color:var(--vscode-editor-foreground);
}
/* ADR-0010: Context box — collapsible summary of ADR before the question */
.ctx-details{
  margin-bottom:16px;
  background:var(--vscode-textBlockQuote-background);
  border:1px solid var(--vscode-textBlockQuote-border,#555);
  border-radius:4px;
  overflow:hidden;
}
.ctx-details summary{
  font-size:11px;
  font-weight:600;
  letter-spacing:.04em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground);
  padding:7px 12px;
  cursor:pointer;
  user-select:none;
  list-style:none;
}
.ctx-details summary::-webkit-details-marker{display:none}
.ctx-details summary::before{content:'▶ '}
.ctx-details[open] summary::before{content:'▼ '}
.ctx-body{
  padding:12px 16px 14px;
  border-top:1px solid var(--vscode-textBlockQuote-border,#555);
  font-size:12px;
  line-height:1.6;
  overflow:auto;
}
/* Markdown rendering inside context body */
.ctx-body h2,.ctx-body h3{font-size:13px;font-weight:600;margin:12px 0 4px}
.ctx-body h2:first-child,.ctx-body h3:first-child{margin-top:0}
.ctx-body p{margin:0 0 8px}
.ctx-body p:last-child{margin-bottom:0}
.ctx-body code{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:1px 4px;border-radius:3px;
}
.ctx-body pre{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:8px 12px;border-radius:4px;
  overflow-x:auto;
  margin:6px 0;
  white-space:pre;
}
.ctx-body blockquote{
  border-left:3px solid var(--vscode-textBlockQuote-border,#555);
  margin:0 0 8px 0;
  padding:4px 12px;
  opacity:.85;
}
.ctx-body table{border-collapse:collapse;width:100%;margin:8px 0}
.ctx-body th,.ctx-body td{
  border:1px solid var(--vscode-textBlockQuote-border,#555);
  padding:4px 8px;
  font-size:11px;
  text-align:left;
}
.ctx-body th{background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));font-weight:600}
.ctx-body ul,.ctx-body ol{padding-left:20px;margin:4px 0}
.ctx-body li{margin:2px 0}
.ctx-body strong{font-weight:600}
.ctx-body em{font-style:italic}
.ctx-body hr{border:none;border-top:1px solid var(--vscode-textBlockQuote-border,#555);margin:10px 0}
/* Why / recommendation */
.why{
  font-size:12px;
  color:var(--vscode-descriptionForeground);
  background:var(--vscode-textBlockQuote-background);
  border-left:3px solid var(--vscode-textBlockQuote-border);
  padding:10px 14px;
  border-radius:0 4px 4px 0;
  margin-bottom:12px;
  line-height:1.5;
}
.recommendation{
  font-size:12px;
  color:var(--vscode-editor-foreground);
  background:var(--vscode-diffEditor-insertedTextBackground,rgba(155,185,85,.1));
  border-left:3px solid var(--vscode-charts-green,#4ec9b0);
  padding:10px 14px;
  border-radius:0 4px 4px 0;
  margin-bottom:20px;
  line-height:1.5;
}
/* ADR-0019: most-recent recommendation in a stack is visually emphasized */
.recommendation.rec-recent{
  border-left-width:4px;
}
/* ADR-0019: attribution chip — color deterministic from author slug */
.rec-chip{
  display:inline-block;
  font-size:10px;font-weight:700;
  letter-spacing:.03em;
  padding:2px 8px;
  border-radius:10px;
  margin-bottom:6px;
  color:#fff;
  background:var(--chip-color, var(--vscode-badge-background));
}
.rec-chip-inferred{
  border-bottom:1px dotted rgba(255,255,255,.7);
}
/* Markdown HTML rendering inside why/recommendation/body containers */
.why code,.recommendation code,.qst-body code{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:1px 4px;border-radius:3px;
}
.why pre,.recommendation pre,.qst-body pre{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:8px 12px;border-radius:4px;
  overflow-x:auto;margin:6px 0;white-space:pre;
}
.why ul,.why ol,.recommendation ul,.recommendation ol{padding-left:20px;margin:6px 0}
.why li,.recommendation li{margin:3px 0}
.why p,.recommendation p,.qst-body p{margin:0 0 6px}
.why p:last-child,.recommendation p:last-child,.qst-body p:last-child{margin-bottom:0}
.why strong,.recommendation strong{font-weight:600}
.why em,.recommendation em{font-style:italic}
.author-row{
  display:flex;align-items:center;gap:8px;
  margin-bottom:10px;
}
.author-row label{
  font-size:12px;
  color:var(--vscode-descriptionForeground);
  white-space:nowrap;
}
.author-row input{
  flex:1;padding:5px 9px;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);
  border-radius:3px;
  font-family:var(--vscode-font-family);font-size:13px;
  outline:none;
}
.author-row input:focus{border-color:var(--vscode-focusBorder)}
textarea{
  width:100%;min-height:110px;
  padding:10px 12px;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);
  border-radius:4px;
  font-family:var(--vscode-font-family);font-size:14px;
  line-height:1.6;resize:vertical;outline:none;
}
textarea:focus{border-color:var(--vscode-focusBorder)}
/* ADR-0023: draft restored indicator — grey, never red (penn-cv 039 It.5) */
.draft-restored{
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  margin-top:5px;
}
.draft-flash{
  display:none;align-items:center;gap:6px;
  color:var(--vscode-descriptionForeground);
  font-size:12px;
  opacity:.85;
}
/* ADR-0023 drift fence: three-choice consent bar */
.drift-bar{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin-top:12px;padding:10px 14px;
  background:var(--vscode-inputValidation-warningBackground,rgba(220,180,50,.12));
  border:1px solid var(--vscode-inputValidation-warningBorder,#a9822c);
  border-radius:4px;
  font-size:12px;
}
.hint{
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  margin-top:5px;margin-bottom:16px;
}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.btn-answer{
  padding:7px 20px;
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
  border:none;border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;font-weight:600;
}
.btn-answer:hover{background:var(--vscode-button-hoverBackground)}
.btn-answer:disabled{opacity:.4;cursor:not-allowed}
.btn-skip{
  padding:7px 14px;
  background:transparent;
  color:var(--vscode-textLink-foreground);
  border:1px solid var(--vscode-textLink-foreground);
  border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  opacity:.8;
}
.btn-skip:hover{opacity:1}
.btn-back{
  padding:7px 14px;
  background:transparent;
  color:var(--vscode-textLink-foreground);
  border:1px solid var(--vscode-textLink-foreground);
  border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  opacity:.8;
}
.btn-back:hover{opacity:1}
.btn-back:disabled{opacity:.3;cursor:not-allowed}
/* ADR-0010: Question list overlay */
#q-overlay{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,.5);z-index:100;
  align-items:flex-start;justify-content:center;
  padding:40px 24px;
}
#q-overlay.open{display:flex}
#q-panel{
  background:var(--vscode-editor-background);
  border:1px solid var(--vscode-widget-border,#555);
  border-radius:6px;width:100%;max-width:640px;
  max-height:calc(100vh - 80px);overflow-y:auto;
  box-shadow:0 8px 32px rgba(0,0,0,.4);
}
.q-panel-hd{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 16px;
  border-bottom:1px solid var(--vscode-widget-border,#555);
  position:sticky;top:0;z-index:1;
  background:var(--vscode-editor-background);
}
.q-panel-title{
  font-size:12px;font-weight:600;
  text-transform:uppercase;letter-spacing:.05em;
  color:var(--vscode-descriptionForeground);
}
.q-close{
  background:transparent;border:none;
  color:var(--vscode-foreground);font-size:16px;
  cursor:pointer;opacity:.7;padding:2px 6px;border-radius:3px;
  font-family:var(--vscode-font-family);
}
.q-close:hover{opacity:1;background:var(--vscode-list-hoverBackground)}
.q-adr-hd{
  padding:8px 16px;
  background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground);
  font-size:12px;font-weight:600;
  position:sticky;top:41px;z-index:1;
}
.q-item{
  display:block;width:100%;
  padding:8px 16px 8px 28px;
  background:transparent;border:none;
  border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.1));
  text-align:left;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  color:var(--vscode-foreground);
}
.q-item:hover{background:var(--vscode-list-hoverBackground)}
.q-item.current{
  background:var(--vscode-list-activeSelectionBackground);
  color:var(--vscode-list-activeSelectionForeground);
}
.qst-body{
  font-size:13px;line-height:1.6;
  margin-bottom:16px;
}
.qst-body code{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:1px 4px;border-radius:3px;
}
.qst-body pre{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:8px 12px;border-radius:4px;
  overflow-x:auto;margin:6px 0;white-space:pre;
}
.qst-body ul,.qst-body ol{padding-left:20px;margin:4px 0}
.qst-body li{margin:2px 0}
.qst-body strong{font-weight:600}
.qst-body em{font-style:italic}
.qst-body p{margin:0 0 8px}
.qst-body p:last-child{margin-bottom:0}
.flash{
  display:none;align-items:center;gap:6px;
  color:var(--vscode-testing-iconPassed,#4ec9b0);
  font-size:13px;font-weight:500;
}
.error-msg{
  display:none;
  color:var(--vscode-errorForeground);
  font-size:12px;margin-top:10px;
}
</style>
</head>
<body>

<div id="empty">
  <div class="icon">✓</div>
  <div style="font-size:16px;font-weight:600">All caught up</div>
  <div style="font-size:13px">No open questions across your ADRs.</div>
</div>

<div id="card">
  <div class="counter" id="counter"></div>
  <div class="progress"><div class="progress-fill" id="pbar"></div></div>

  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="adr-link" id="adr-link" style="margin-bottom:0"></button>
    <a id="open-in-file" href="#" style="font-size:11px;color:var(--vscode-textLink-foreground);text-decoration:none;opacity:.8">Open in file ↗</a>
    <a id="q-list-link" href="#" style="font-size:11px;color:var(--vscode-textLink-foreground);text-decoration:none;opacity:.8">List all open questions ↗</a>
  </div>

  <!-- ADR-0010: Collapsible ADR context box (Human Context + AI Interpretation) -->
  <details class="ctx-details" id="ctx-details" style="display:none">
    <summary>ADR context</summary>
    <div class="ctx-body" id="ctx-body"></div>
  </details>

  <div class="qtext" id="qtext"></div>
  <div class="why" id="why" style="display:none"></div>
  <div class="qst-body" id="body" style="display:none"></div>
  <div id="rec-wrap"></div>
  <div class="qst-body" id="body-post" style="display:none"></div>

  <div class="author-row">
    <label for="author">Answering as:</label>
    <input id="author" type="text" placeholder="Your name" autocomplete="off" />
  </div>

  <textarea id="ans" placeholder="Type your answer… (Cmd+Enter to submit)"></textarea>
  <div class="draft-restored" id="draft-restored" style="display:none"></div>
  <div class="hint">Cmd+Enter to submit · Skip to come back later</div>

  <div class="row">
    <button class="btn-answer" id="btn-ans">Answer →</button>
    <button class="btn-back" id="btn-back">← Back</button>
    <button class="btn-skip" id="btn-skip">Skip</button>
    <span class="flash" id="flash">✓ Answered</span>
    <span class="draft-flash" id="draft-flash">✓ draft saved</span>
  </div>
  <div class="error-msg" id="err"></div>

  <!-- ADR-0023 drift fence: three-choice consent, never write blind -->
  <div class="drift-bar" id="drift-bar" style="display:none">
    <span>This file changed while you were answering.</span>
    <button class="btn-skip" id="btn-drift-refresh">Refresh</button>
    <button class="btn-skip" id="btn-drift-write">Write anyway</button>
    <button class="btn-skip" id="btn-drift-hold">Hold draft</button>
  </div>
</div>

<div id="q-overlay">
  <div id="q-panel">
    <div class="q-panel-hd">
      <span class="q-panel-title" id="q-panel-title">Open Questions</span>
      <button class="q-close" id="q-close" title="Close (Esc)">✕</button>
    </div>
    <div id="q-panel-body"></div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let questions = [], idx = 0;
let recCollapseThreshold = 0;
const saved = vscode.getState() || {};

const $id = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Minimal inline markdown renderer (ADR-0010)
// Handles: headings, bold, italic, inline code, fenced code, tables,
//          blockquotes, HR, ordered and unordered lists.
// No external dependencies — all inline to satisfy VS Code CSP.
// ---------------------------------------------------------------------------
function renderMarkdown(md) {
  if (!md) return '';
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Process fenced code blocks first (protect from inline transforms)
  const codeBlocks = [];
  md = md.replace(/\`\`\`[\\s\\S]*?\`\`\`/g, m => {
    const lang = m.match(/\`\`\`(\\w*)/)?.[1] || '';
    const code = m.replace(/\`\`\`\\w*\\n?/, '').replace(/\`\`\`$/, '');
    codeBlocks.push('<pre><code>' + esc(code.trimEnd()) + '</code></pre>');
    return '\\x00CODE' + (codeBlocks.length - 1) + '\\x00';
  });

  // Tables
  function renderTable(block) {
    const rows = block.trim().split('\\n');
    if (rows.length < 2) return block;
    const header = rows[0].split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>'<th>'+renderInline(c.trim())+'</th>').join('');
    const body = rows.slice(2).map(r=>{
      const cells = r.split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>'<td>'+renderInline(c.trim())+'</td>').join('');
      return '<tr>'+cells+'</tr>';
    }).join('');
    return '<table><thead><tr>'+header+'</tr></thead><tbody>'+body+'</tbody></table>';
  }

  function renderInline(s) {
    s = esc(s);
    // Protect backtick spans FIRST — their content must not be processed by bold/italic
    const codes = [];
    s = s.replace(/\`([^\`]+)\`/g, (_, c) => { codes.push(c); return '\\x02' + (codes.length-1) + '\\x02'; });
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Restore backtick spans as <code> elements
    s = s.replace(/\\x02(\\d+)\\x02/g, (_, i) => '<code>' + codes[+i] + '</code>');
    return s;
  }

  const lines = md.split('\\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Restored code block placeholder
    if (/^\\x00CODE\\d+\\x00$/.test(line.trim())) {
      const idx = parseInt(line.trim().replace(/\\x00CODE(\\d+)\\x00/,'$1'));
      out.push(codeBlocks[idx]);
      i++; continue;
    }

    // Tables: detect by | delimiter in first cell
    if (/^\\|/.test(line) && i + 1 < lines.length && /^\\|[-: |]+\\|/.test(lines[i+1])) {
      let tableEnd = i;
      while (tableEnd < lines.length && /^\\|/.test(lines[tableEnd])) tableEnd++;
      out.push(renderTable(lines.slice(i, tableEnd).join('\\n')));
      i = tableEnd; continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

    // Headings
    const hm = line.match(/^(#{1,4})\\s+(.*)/);
    if (hm) { out.push('<h'+(hm[1].length+1)+'>'+renderInline(hm[2])+'</h'+(hm[1].length+1)+'>'); i++; continue; }

    // Blockquote
    if (line.startsWith('> ')) { out.push('<blockquote>'+renderInline(line.slice(2))+'</blockquote>'); i++; continue; }

    // Unordered list
    if (/^[\\-\\*]\\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\\-\\*]\\s+/.test(lines[i])) {
        items.push('<li>'+renderInline(lines[i].replace(/^[\\-\\*]\\s+/,''))+'</li>');
        i++;
      }
      out.push('<ul>'+items.join('')+'</ul>');
      continue;
    }

    // Ordered list
    if (/^\\d+\\.\\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\\d+\\.\\s+/.test(lines[i])) {
        items.push('<li>'+renderInline(lines[i].replace(/^\\d+\\.\\s+/,''))+'</li>');
        i++;
      }
      out.push('<ol>'+items.join('')+'</ol>');
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph
    out.push('<p>'+renderInline(line)+'</p>');
    i++;
  }

  return out.join('\\n');
}

// ---------------------------------------------------------------------------
// Stacked recommendation rendering (ADR-0010 ANS + ADR-0019 attribution model)
// Default: every recommendation stays expanded ("thinking traces" — Jérémie).
// When adrManager.panel.recommendationCollapseThreshold (N) > 0 and there
// are more than N blocks, older-than-N collapse behind a disclosure; the
// most recent N always stay expanded. Each block carries an attribution
// chip; chip color is deterministic from the author slug; authorInferred
// (legacy **My recommendation**: blocks) gets a dotted-underline affordance.
// ---------------------------------------------------------------------------
function escText(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function authorColor(author) {
  if (!author) return 'var(--vscode-descriptionForeground)';
  let hash = 0;
  for (let i = 0; i < author.length; i++) hash = (hash * 31 + author.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 55%, 40%)';
}

function renderRecommendationBlock(rec, isMostRecent) {
  const author = rec.author || 'Recommendation';
  const color = authorColor(rec.author);
  const dateStr = rec.date ? ' · ' + escText(rec.date) : '';
  const inferredClass = rec.authorInferred ? ' rec-chip-inferred' : '';
  const inferredTitle = rec.authorInferred ? ' title="Author inferred from the ADR Deciders field"' : '';
  const emphClass = isMostRecent ? ' rec-recent' : '';
  return '<div class="recommendation' + emphClass + '">' +
    '<span class="rec-chip' + inferredClass + '" style="--chip-color:' + color + '"' + inferredTitle + '>' +
    escText(author) + dateStr + '</span>' +
    renderMarkdown(rec.text) +
    '</div>';
}

function renderRecommendations(list) {
  const wrap = $id('rec-wrap');
  if (!list || list.length === 0) { wrap.innerHTML = ''; return; }

  const threshold = recCollapseThreshold > 0 ? recCollapseThreshold : list.length;
  const splitAt = Math.max(0, list.length - threshold);
  const older = list.slice(0, splitAt);
  const recent = list.slice(splitAt);
  const lastIdx = list.length - 1;

  let html = '';
  if (older.length > 0) {
    const label = older.length + ' earlier recommendation' + (older.length > 1 ? 's' : '');
    html += '<details class="ctx-details rec-older"><summary>' + label + '</summary><div class="ctx-body">' +
      older.map((r, i) => renderRecommendationBlock(r, i === lastIdx)).join('') +
      '</div></details>';
  }
  html += recent.map((r, i) => renderRecommendationBlock(r, (splitAt + i) === lastIdx)).join('');
  wrap.innerHTML = html;
}

// Restore author from persisted state
$id('author').value = saved.author || '';
$id('author').addEventListener('input', () => {
  saved.author = $id('author').value;
  vscode.setState(saved);
});

// Cmd/Ctrl+Enter submits
$id('ans').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
});

$id('btn-ans').addEventListener('click', submit);
$id('open-in-file').addEventListener('click', e => {
  e.preventDefault();
  if (!questions[idx]) return;
  vscode.postMessage({ type: 'jumpTo', adrPath: questions[idx].adrPath, lineNumber: questions[idx].lineStart });
});

$id('btn-skip').addEventListener('click', () => {
  idx = (idx + 1) % Math.max(questions.length, 1);
  render();
  vscode.postMessage({ type: 'skip' });
});

$id('btn-back').addEventListener('click', () => {
  if (idx > 0) { idx--; render(); }
});

function showOverlay() {
  renderOverlay();
  $id('q-overlay').classList.add('open');
  const cur = $id('q-panel-body').querySelector('.current');
  if (cur) cur.scrollIntoView({ block: 'center' });
}
function hideOverlay() { $id('q-overlay').classList.remove('open'); }
function renderOverlay() {
  $id('q-panel-title').textContent = 'Open Questions (' + questions.length + ')';
  const byAdr = {};
  questions.forEach((q, i) => {
    if (!byAdr[q.adrNumber]) byAdr[q.adrNumber] = { title: q.adrTitle, number: q.adrNumber, items: [] };
    byAdr[q.adrNumber].items.push({ q, i });
  });
  let html = '';
  for (const k of Object.keys(byAdr).sort((a,b) => Number(a)-Number(b))) {
    const g = byAdr[k];
    const num = String(g.number).padStart(4,'0');
    html += '<div class="q-adr-hd">ADR-' + num + ': ' + g.title + '</div>';
    for (const {q,i} of g.items) {
      html += '<button class="q-item' + (i===idx?' current':'') + '" data-qi="' + i + '">' + q.text + '</button>';
    }
  }
  $id('q-panel-body').innerHTML = html;
}

$id('q-list-link').addEventListener('click', e => { e.preventDefault(); showOverlay(); });
$id('q-close').addEventListener('click', hideOverlay);
$id('q-overlay').addEventListener('click', e => { if (e.target === $id('q-overlay')) hideOverlay(); });
$id('q-panel-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-qi]');
  if (!btn) return;
  idx = parseInt(btn.dataset.qi, 10);
  hideOverlay();
  render();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideOverlay(); });

$id('adr-link').addEventListener('click', () => {
  if (!questions[idx]) return;
  vscode.postMessage({ type: 'jumpTo', adrPath: questions[idx].adrPath, lineNumber: questions[idx].lineStart });
});

function submit(force) {
  const text = $id('ans').value.trim();
  const author = $id('author').value.trim() || 'Human';
  if (!text || !questions[idx]) return;
  $id('btn-ans').disabled = true;
  $id('err').style.display = 'none';
  $id('drift-bar').style.display = 'none';
  const q = questions[idx];
  vscode.postMessage({
    type: 'answer', questionId: q.id, adrPath: q.adrPath, lineStart: q.lineStart,
    answerText: text, authorName: author, draftKey: q.draftKey, fileChecksum: q.fileChecksum,
    force: !!force,
  });
}

// ---------------------------------------------------------------------------
// ADR-0023: draft auto-save — debounced ~500ms per keystroke
// ---------------------------------------------------------------------------
let draftSaveTimer = null;
$id('ans').addEventListener('input', () => {
  if (!questions[idx]) return;
  const q = questions[idx];
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    vscode.postMessage({
      type: 'draft', draftKey: q.draftKey, adrPath: q.adrPath, adrNumber: q.adrNumber,
      questionText: q.text, draftText: $id('ans').value, totalOccurrences: q.totalOccurrences,
    });
    $id('draft-flash').style.display = 'inline-flex';
    setTimeout(() => { $id('draft-flash').style.display = 'none'; }, 900);
  }, 500);
});

$id('btn-drift-refresh').addEventListener('click', () => {
  $id('drift-bar').style.display = 'none';
  $id('btn-ans').disabled = false;
  vscode.postMessage({ type: 'refreshRequest' });
});
$id('btn-drift-write').addEventListener('click', () => {
  $id('drift-bar').style.display = 'none';
  submit(true);
});
$id('btn-drift-hold').addEventListener('click', () => {
  // Draft is already auto-saved — nothing further to do. Just dismiss.
  $id('drift-bar').style.display = 'none';
  $id('btn-ans').disabled = false;
});

function render() {
  if (questions.length === 0) {
    $id('empty').style.display = 'flex';
    $id('card').style.display = 'none';
    return;
  }
  $id('empty').style.display = 'none';
  $id('card').style.display = 'block';

  const q = questions[idx];
  const pct = (idx / questions.length) * 100;
  $id('counter').textContent = 'Question ' + (idx + 1) + ' of ' + questions.length;
  $id('pbar').style.width = pct + '%';
  $id('adr-link').textContent = 'ADR-' + String(q.adrNumber).padStart(4,'0') + ': ' + q.adrTitle;

  $id('qtext').textContent = q.text;

  // ADR-0010: Collapsible context box
  if (q.adrContext) {
    $id('ctx-details').style.display = 'block';
    $id('ctx-body').innerHTML = renderMarkdown(q.adrContext);
  } else {
    $id('ctx-details').style.display = 'none';
  }

  const ctx = [q.whyAsking, q.need ? '**Need:** ' + q.need : null].filter(Boolean).join('\\n\\n');
  if (ctx) { $id('why').style.display = 'block'; $id('why').innerHTML = renderMarkdown(ctx); }
  else { $id('why').style.display = 'none'; }

  if (q.body) { $id('body').style.display = 'block'; $id('body').innerHTML = renderMarkdown(q.body); }
  else { $id('body').style.display = 'none'; }

  renderRecommendations(q.recommendations && q.recommendations.length ? q.recommendations : (q.recommendation ? [{ text: q.recommendation }] : []));

  if (q.bodyPost) { $id('body-post').style.display = 'block'; $id('body-post').innerHTML = renderMarkdown(q.bodyPost); }
  else { $id('body-post').style.display = 'none'; }

  // ADR-0023: restore an in-progress draft, if one exists for this question's key.
  if (q.draftText) {
    $id('ans').value = q.draftText;
    const savedAt = q.draftSavedAt ? new Date(q.draftSavedAt).toLocaleTimeString() : '';
    $id('draft-restored').textContent = 'Draft restored' + (savedAt ? ' (saved ' + savedAt + ')' : '');
    $id('draft-restored').style.display = 'block';
  } else {
    $id('ans').value = '';
    $id('draft-restored').style.display = 'none';
  }
  $id('flash').style.display = 'none';
  $id('drift-bar').style.display = 'none';
  $id('btn-ans').disabled = false;
  $id('btn-back').disabled = idx === 0;
  $id('err').style.display = 'none';
  setTimeout(() => $id('ans').focus(), 50);
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'questions') {
    questions = msg.questions;
    recCollapseThreshold = msg.recommendationCollapseThreshold || 0;
    // Clamp idx: if the list shrank (answered question removed), idx may now
    // point past the end. Clamp to last item rather than wrapping to 0 —
    // this keeps the user on the question they just skipped past, not the first.
    if (questions.length === 0) { idx = 0; }
    else if (idx >= questions.length) { idx = questions.length - 1; }

    // Pre-fill author: saved state > git config > top name from ADR index
    if (!saved.author && (msg.gitAuthor || (msg.authorSuggestions && msg.authorSuggestions[0]))) {
      const best = msg.gitAuthor || msg.authorSuggestions[0];
      $id('author').value = best;
      saved.author = best;
      vscode.setState(saved);
    }

    render();
  }
  if (msg.type === 'answered') {
    // Regression fix (2026-03-12): do NOT advance idx here.
    // The 'questions' refresh (triggered by file-save) already removes the
    // answered question and re-renders with the correct next idx.
    // Advancing here caused a double-move: answering second-to-last would
    // show the last question (correct), then wrap back to index 0 (wrong).
    // One owner of idx: the 'questions' handler. See ADR-0010.
    $id('flash').style.display = 'flex';
    $id('btn-ans').disabled = false;
    setTimeout(() => { $id('flash').style.display = 'none'; }, 900);
  }
  if (msg.type === 'navigate') {
    const i = questions.findIndex(q => q.id === msg.questionId);
    if (i >= 0) { idx = i; render(); }
  }
  if (msg.type === 'error') {
    $id('btn-ans').disabled = false;
    $id('err').style.display = 'block';
    $id('err').textContent = msg.message;
  }
  if (msg.type === 'driftDetected') {
    // ADR-0023 drift fence: the file changed under this in-flight answer.
    // Never write blind — the draft is already auto-saved, so all three
    // choices here are safe.
    $id('btn-ans').disabled = false;
    $id('drift-bar').style.display = 'flex';
  }
});
</script>
</body>
</html>`
}
