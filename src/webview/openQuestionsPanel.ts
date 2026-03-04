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
import type { AdrIndex } from '../index/adrIndex'

// ---------------------------------------------------------------------------
// Serialized question shape (what we send to the webview)
// ---------------------------------------------------------------------------

interface WebviewQuestion {
  id: string
  text: string
  whyAsking?: string
  need?: string
  adrNumber: number
  adrTitle: string
  adrPath: string
  lineStart: number  // 1-indexed line of the ### QST: heading
}

// ---------------------------------------------------------------------------
// Messages webview → extension
// ---------------------------------------------------------------------------

type WebviewMessage =
  | { type: 'answer'; questionId: string; adrPath: string; lineStart: number; answerText: string; authorName: string }
  | { type: 'skip' }
  | { type: 'jumpTo'; adrPath: string; lineNumber: number }
  | { type: 'ready' }

// ---------------------------------------------------------------------------
// Panel class
// ---------------------------------------------------------------------------

export class OpenQuestionsPanel {
  private static instance: OpenQuestionsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []

  // ---------------------------------------------------------------------------

  static createOrShow(index: AdrIndex): void {
    if (OpenQuestionsPanel.instance) {
      OpenQuestionsPanel.instance.panel.reveal(vscode.ViewColumn.One)
      return
    }
    new OpenQuestionsPanel(index)
  }

  private constructor(private readonly index: AdrIndex) {
    OpenQuestionsPanel.instance = this

    this.panel = vscode.window.createWebviewPanel(
      'adrOpenQuestions',
      'Open Questions',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.webview.html = getHtml()
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
      const cleanTitle = adr.title.replace(/^ADR-\d{4}[:\s\-]+/i, '').trim() || adr.title
      return adr.questions
        .filter(q => !q.isAnswered)
        .map(q => ({
          id: q.id,
          text: q.text,
          whyAsking: q.whyAsking,
          need: q.need,
          adrNumber: adr.number,
          adrTitle: cleanTitle,
          adrPath: adr.path,
          lineStart: q.lineStart,
        }))
    })

    this.panel.webview.postMessage({
      type: 'questions',
      questions,
      gitAuthor: getGitUserName(),
      authorSuggestions: extractHumanNames(this.index),
    })
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'answer': await this.writeAnswer(msg); break
      case 'skip': this.panel.webview.postMessage({ type: 'skip_ack' }); break
      case 'jumpTo': await this.openAtLine(msg.adrPath, msg.lineNumber); break
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
  }): Promise<void> {
    try {
      const uri = vscode.Uri.file(msg.adrPath)
      const doc = await vscode.workspace.openTextDocument(uri)
      const lines = doc.getText().split('\n')
      const edit = new vscode.WorkspaceEdit()

      // Search window: from QST heading line (1-indexed → 0-indexed) forward
      const start = msg.lineStart - 1
      const end = Math.min(start + 40, lines.length)

      let statusLineIdx = -1
      let ansHeaderLineIdx = -1
      let fillLineIdx = -1

      for (let i = start; i < end; i++) {
        const trimmed = lines[i].trim()
        if (trimmed.startsWith('- Status:') && statusLineIdx === -1) statusLineIdx = i
        if (/^\*\*ANS:\*\*/.test(trimmed) && ansHeaderLineIdx === -1) ansHeaderLineIdx = i
        if (trimmed === '[Fill this in]' && ansHeaderLineIdx !== -1 && fillLineIdx === -1) fillLineIdx = i
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
          message: `Could not find the ANS block near line ${msg.lineStart} in ${msg.adrPath}. Please answer this one manually.`,
        })
        return
      }

      await vscode.workspace.applyEdit(edit)
      await vscode.workspace.save(uri)

      this.panel.webview.postMessage({ type: 'answered', questionId: msg.questionId })
    } catch (err) {
      this.panel.webview.postMessage({ type: 'error', message: String(err) })
    }
  }

  private async openAtLine(adrPath: string, lineNumber: number): Promise<void> {
    const uri = vscode.Uri.file(adrPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two, { preserveFocus: true })
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

function getHtml(): string {
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
#card{max-width:680px;margin:0 auto}
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
.why{
  font-size:12px;
  color:var(--vscode-descriptionForeground);
  background:var(--vscode-textBlockQuote-background);
  border-left:3px solid var(--vscode-textBlockQuote-border);
  padding:10px 14px;
  border-radius:0 4px 4px 0;
  margin-bottom:20px;
  white-space:pre-wrap;
  line-height:1.5;
}
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

  <button class="adr-link" id="adr-link"></button>
  <div class="qtext" id="qtext"></div>
  <div class="why" id="why" style="display:none"></div>

  <div class="author-row">
    <label for="author">Answering as:</label>
    <input id="author" type="text" placeholder="Your name" autocomplete="off" list="author-list" />
    <datalist id="author-list"></datalist>
  </div>

  <textarea id="ans" placeholder="Type your answer… (Cmd+Enter to submit)"></textarea>
  <div class="hint">Cmd+Enter to submit · Skip to come back later</div>

  <div class="row">
    <button class="btn-answer" id="btn-ans">Answer →</button>
    <button class="btn-skip" id="btn-skip">Skip</button>
    <span class="flash" id="flash">✓ Answered</span>
  </div>
  <div class="error-msg" id="err"></div>
</div>

<script>
const vscode = acquireVsCodeApi();
let questions = [], idx = 0;
const saved = vscode.getState() || {};

const $id = id => document.getElementById(id);

// Restore author from persisted state (set on first 'questions' message if empty)
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

$id('btn-skip').addEventListener('click', () => {
  idx = (idx + 1) % Math.max(questions.length, 1);
  render();
  vscode.postMessage({ type: 'skip' });
});

$id('adr-link').addEventListener('click', () => {
  if (!questions[idx]) return;
  vscode.postMessage({ type: 'jumpTo', adrPath: questions[idx].adrPath, lineNumber: questions[idx].lineStart });
});

function submit() {
  const text = $id('ans').value.trim();
  const author = $id('author').value.trim() || 'Human';
  if (!text || !questions[idx]) return;
  $id('btn-ans').disabled = true;
  $id('err').style.display = 'none';
  const q = questions[idx];
  vscode.postMessage({ type: 'answer', questionId: q.id, adrPath: q.adrPath, lineStart: q.lineStart, answerText: text, authorName: author });
}

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

  const ctx = [q.whyAsking, q.need ? 'Need: ' + q.need : null].filter(Boolean).join('\\n');
  if (ctx) { $id('why').style.display = 'block'; $id('why').textContent = ctx; }
  else { $id('why').style.display = 'none'; }

  $id('ans').value = '';
  $id('flash').style.display = 'none';
  $id('btn-ans').disabled = false;
  $id('err').style.display = 'none';
  setTimeout(() => $id('ans').focus(), 50);
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'questions') {
    questions = msg.questions;
    if (idx >= questions.length) idx = 0;

    // Pre-fill author: saved state > git config > top name from ADR index
    if (!saved.author && (msg.gitAuthor || (msg.authorSuggestions && msg.authorSuggestions[0]))) {
      const best = msg.gitAuthor || msg.authorSuggestions[0];
      $id('author').value = best;
      saved.author = best;
      vscode.setState(saved);
    }

    // Populate datalist with known human names
    if (msg.authorSuggestions && msg.authorSuggestions.length) {
      const dl = $id('author-list');
      dl.innerHTML = msg.authorSuggestions
        .map(n => \`<option value="\${n}">\`)
        .join('');
    }

    render();
  }
  if (msg.type === 'answered') {
    $id('flash').style.display = 'flex';
    setTimeout(() => {
      if (idx >= questions.length - 1) idx = 0;
      render();
    }, 900);
  }
  if (msg.type === 'error') {
    $id('btn-ans').disabled = false;
    $id('err').style.display = 'block';
    $id('err').textContent = msg.message;
  }
});
</script>
</body>
</html>`
}
