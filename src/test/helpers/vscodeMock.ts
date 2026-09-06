/**
 * A minimal `vscode` module mock — Fixture 5's founding mission (docs/inbox/
 * 2026-09-05-2236-gleaner-founding-brief-menu-command-smoke-test-harness.md):
 * this repo had NO vscode mock anywhere, which is why every one of
 * extension.ts's ~35 command handlers had never once been actually invoked
 * by a test — every prior test regex-matched extension.ts's source text
 * instead (see any `*Wiring.test.ts`). The copyDeepLink/SLUG_RE crash (a
 * real, reproducible bug that shipped and sat unlogged for three days) is
 * exactly the class of bug that gap misses: a structural test can confirm a
 * string never appears near a function; it cannot confirm that calling the
 * function with a real mixed-case git remote doesn't throw.
 *
 * Only the surface this extension actually touches (grep-verified against
 * every `import ... from 'vscode'` call site in src/extension.ts,
 * src/webview/openQuestionsPanel.ts, src/views/adrTreeProvider.ts,
 * src/views/documentLinkProvider.ts, src/views/terminalLinkProvider.ts, and
 * src/watchers/rootWatcherLifecycle.ts) — grow this only when a real usage
 * demands it, not speculatively.
 *
 * Wired in as a vitest-only module alias (`test.alias` in vite.config.ts),
 * NOT a top-level `resolve.alias` — the real `vite build` step marks
 * 'vscode' `external` and must never see this file substituted in.
 */

import * as fs from 'fs'
import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// Command registry — the seam the harness invokes real handlers through
// ---------------------------------------------------------------------------

type CommandHandler = (...args: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any

const commandRegistry = new Map<string, CommandHandler>()

/** Test-only accessor: the handler `activate()` registered for `commandId`, or undefined if nothing registered it (a real gap the sweep test asserts against). */
export function getRegisteredCommand(commandId: string): CommandHandler | undefined {
  return commandRegistry.get(commandId)
}

export function registeredCommandIds(): string[] {
  return Array.from(commandRegistry.keys())
}

/** Full reset, including the command registry — call before a fresh `activate()`. */
export function resetVscodeMock(): void {
  commandRegistry.clear()
  mockWorkspace.workspaceFolders = undefined
  resetInteractionState()
}

/**
 * Per-test reset that leaves the command registry alone — for a describe
 * block that calls `activate()` ONCE (in `beforeAll`) and then invokes many
 * already-registered handlers across individual tests, each of which needs
 * a clean quickpick/inputbox/config slate but must not lose the handlers
 * activation just registered.
 */
export function resetInteractionState(): void {
  mockWindow.activeTextEditor = undefined
  configOverrides.clear()
  extensionOverrides.clear()
  quickPickQueue.length = 0
  inputBoxQueue.length = 0
  warningMessageQueue.length = 0
}

// ---------------------------------------------------------------------------
// Position / Range / Selection / Uri / EventEmitter / RelativePattern
// ---------------------------------------------------------------------------

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  public start: Position
  public end: Position
  constructor(startLine: number | Position, startChar?: number | Position, endLine?: number, endChar?: number) {
    if (startLine instanceof Position && startChar instanceof Position) {
      this.start = startLine
      this.end = startChar
    } else {
      this.start = new Position(startLine as number, startChar as number)
      this.end = new Position(endLine as number, endChar as number)
    }
  }
}

export class Selection extends Range {
  constructor(anchor: Position, active: Position) {
    super(anchor, active)
  }
}

export class RelativePattern {
  constructor(public base: string | { uri: { fsPath: string } }, public pattern: string) {}
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => any> = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  event = (listener: (e: T) => any): { dispose(): void } => { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.listeners.push(listener)
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener) } }
  }
  fire(e: T): void { for (const l of this.listeners) l(e) }
  dispose(): void { this.listeners = [] }
}

export const Uri = {
  file: (fsPath: string) => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}`, path: fsPath }),
  parse: (value: string) => ({ fsPath: value.replace(/^[a-z]+:\/\//, ''), scheme: value.split(':')[0], toString: () => value }),
  joinPath: (base: { fsPath: string }, ...segments: string[]) => {
    const joined = [base.fsPath, ...segments].join('/').replace(/\/+/g, '/')
    return Uri.file(joined)
  },
}

// ---------------------------------------------------------------------------
// TreeItem / enums — AdrTreeItem extends TreeItem for real
// ---------------------------------------------------------------------------

export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum DiagnosticSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }
export enum CodeActionKind { QuickFix = 'quickfix' as any } // eslint-disable-line @typescript-eslint/no-explicit-any
export enum ViewColumn { One = 1, Two = 2 }
export enum TextEditorRevealType { Default = 0, InCenter = 1, InCenterIfOutsideViewport = 2, AtTop = 3 }

export class TreeItem {
  public label: string | { label: string }
  public collapsibleState: TreeItemCollapsibleState
  public id?: string
  public contextValue?: string
  public iconPath?: unknown
  public description?: string | boolean
  public tooltip?: unknown
  public command?: { command: string; title: string; arguments?: unknown[] }
  public resourceUri?: { fsPath: string }
  constructor(label: string | { label: string }, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label
    this.collapsibleState = collapsibleState ?? TreeItemCollapsibleState.None
  }
}

export class ThemeIcon {
  constructor(public id: string, public color?: unknown) {}
}
export class ThemeColor {
  constructor(public id: string) {}
}

export class Diagnostic {
  public source?: string
  public code?: string | number
  constructor(public range: Range, public message: string, public severity?: DiagnosticSeverity) {}
}

export class CodeAction {
  public diagnostics?: Diagnostic[]
  public isPreferred?: boolean
  public edit?: WorkspaceEdit
  constructor(public title: string, public kind?: CodeActionKind) {}
}

/**
 * Records operations; `workspace.applyEdit` below replays them onto the
 * REAL file on disk — every real call site in extension.ts only ever
 * builds line-granular edits (`insert` at a line's start, `replace` across
 * a whole `doc.lineAt(i).range`), so that's the only shape this needs to
 * support. Needed for real "did the content actually land, and did it not
 * clobber what was there before" assertions (Fixture 5's priority-A pass,
 * 2026-09-06) — a purely-recorded, never-applied edit can't tell that
 * apart from a silent no-op.
 */
export class WorkspaceEdit {
  public operations: Array<{ type: 'insert' | 'replace' | 'delete'; uri: { fsPath: string }; range?: Range; position?: Position; text?: string }> = []
  insert(uri: { fsPath: string }, position: Position, text: string): void {
    this.operations.push({ type: 'insert', uri, position, text })
  }
  replace(uri: { fsPath: string }, range: Range, text: string): void {
    this.operations.push({ type: 'replace', uri, range, text })
  }
  delete(uri: { fsPath: string }, range: Range): void {
    this.operations.push({ type: 'delete', uri, range })
  }
}

// ---------------------------------------------------------------------------
// window.* — quickpick/inputbox/warning queues let a test script exactly
// what the "user" picks next, defaulting to escape/cancel (undefined) so a
// handler invoked with no scripted response degrades the same way a real
// human hitting Escape would, rather than hanging or throwing.
// ---------------------------------------------------------------------------

const quickPickQueue: unknown[] = []
const inputBoxQueue: (string | undefined)[] = []
const warningMessageQueue: (string | undefined)[] = []

/** Test-only: script the next N showQuickPick resolutions (FIFO). */
export function queueQuickPick(value: unknown): void { quickPickQueue.push(value) }
/** Test-only: script the next N showInputBox resolutions (FIFO). */
export function queueInputBox(value: string | undefined): void { inputBoxQueue.push(value) }
/** Test-only: script the next N showWarningMessage resolutions (FIFO) — for modal confirm dialogs like excludeRoot's. */
export function queueWarningMessage(value: string | undefined): void { warningMessageQueue.push(value) }

function fakeTextEditor(doc: ReturnType<typeof fakeTextDocument>) {
  return {
    document: doc,
    selection: undefined as unknown,
    revealRange: vi.fn(),
  }
}

function fakeTextDocument(uri: { fsPath: string }) {
  let text: string
  try { text = fs.readFileSync(uri.fsPath, 'utf8') } catch { text = '' }
  const lines = text.split('\n')
  return {
    uri,
    getText: () => text,
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: new Range(line, 0, line, (lines[line] ?? '').length),
    }),
    lineCount: lines.length,
    save: vi.fn().mockResolvedValue(true),
  }
}

export const mockWindow = {
  activeTextEditor: undefined as ReturnType<typeof fakeTextEditor> | undefined,
  showInformationMessage: vi.fn(async (..._args: unknown[]) => undefined),
  showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined),
  showWarningMessage: vi.fn(async (..._args: unknown[]) => warningMessageQueue.shift()),
  showQuickPick: vi.fn(async (..._args: unknown[]) => quickPickQueue.shift()),
  showInputBox: vi.fn(async (..._args: unknown[]) => inputBoxQueue.shift()),
  setStatusBarMessage: vi.fn((..._args: unknown[]) => ({ dispose: vi.fn() })),
  createOutputChannel: vi.fn((_name: string) => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  createStatusBarItem: vi.fn((_alignment?: StatusBarAlignment, _priority?: number) => ({
    text: '',
    tooltip: undefined as unknown,
    command: undefined as unknown,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  createTreeView: vi.fn((_viewId: string, _opts: unknown) => ({
    badge: undefined as unknown,
    reveal: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
  })),
  createWebviewPanel: vi.fn((_viewType: string, title: string, _showOptions: unknown, _options: unknown) => ({
    title,
    webview: {
      html: '',
      postMessage: vi.fn().mockResolvedValue(true),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      asWebviewUri: (uri: { fsPath: string }) => uri,
      cspSource: 'vscode-mock:',
    },
    reveal: vi.fn(),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  })),
  registerTerminalLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
  showTextDocument: vi.fn(async (doc: unknown, _opts?: unknown) => fakeTextEditor(doc as ReturnType<typeof fakeTextDocument>)),
  withProgress: vi.fn(async (_opts: unknown, task: (...a: unknown[]) => unknown) => task({ report: vi.fn() }, { isCancellationRequested: false })),
}

// ---------------------------------------------------------------------------
// workspace.*
// ---------------------------------------------------------------------------

const configOverrides = new Map<string, unknown>()

/** Test-only: force `getConfiguration(section).get(key, default)` to return `value` for `${section}.${key}`. */
export function setConfigOverride(fullKey: string, value: unknown): void {
  configOverrides.set(fullKey, value)
}

function makeConfiguration(section: string) {
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T => {
      const full = `${section}.${key}`
      return configOverrides.has(full) ? (configOverrides.get(full) as T) : (defaultValue as T)
    }),
    update: vi.fn(async (key: string, value: unknown) => {
      configOverrides.set(`${section}.${key}`, value)
    }),
  }
}

export const mockWorkspace = {
  workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
  getConfiguration: vi.fn((section = 'adrManager', _scope?: unknown) => makeConfiguration(section)),
  openTextDocument: vi.fn(async (uri: { fsPath: string }) => fakeTextDocument(uri)),
  applyEdit: vi.fn(async (edit: WorkspaceEdit) => {
    try {
      const byFile = new Map<string, typeof edit.operations>()
      for (const op of edit.operations) {
        const arr = byFile.get(op.uri.fsPath) ?? []
        arr.push(op)
        byFile.set(op.uri.fsPath, arr)
      }
      for (const [fsPath, ops] of byFile) {
        const lines = fs.readFileSync(fsPath, 'utf8').split('\n')
        // Apply bottom-to-top so an earlier operation's line-count change
        // never shifts a later operation's still-untouched line index.
        const sorted = [...ops].sort((a, b) => (b.position?.line ?? b.range!.start.line) - (a.position?.line ?? a.range!.start.line))
        for (const op of sorted) {
          if (op.type === 'insert' && op.position) {
            const inserted = op.text!.split('\n')
            if (inserted[inserted.length - 1] === '') inserted.pop() // trailing '' from a text block that itself ends in '\n'
            lines.splice(op.position.line, 0, ...inserted)
          } else if (op.type === 'replace' && op.range) {
            lines.splice(op.range.start.line, op.range.end.line - op.range.start.line + 1, op.text ?? '')
          } else if (op.type === 'delete' && op.range) {
            lines.splice(op.range.start.line, op.range.end.line - op.range.start.line + 1)
          }
        }
        fs.writeFileSync(fsPath, lines.join('\n'), 'utf8')
      }
      return true
    } catch {
      return false
    }
  }),
  save: vi.fn(async (_uri: { fsPath: string }) => true),
  onDidChangeTextDocument: vi.fn((_listener: unknown) => ({ dispose: vi.fn() })),
  createFileSystemWatcher: vi.fn((_pattern: unknown) => ({
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  })),
  // Real disk operations (not recorded-only): excludeRoot and
  // mintTourFromFilter both write real config/tour files whose actual
  // on-disk presence and content is exactly what Fixture 5's priority-A
  // pass (2026-09-06) needs to assert against.
  fs: {
    createDirectory: vi.fn(async (uri: { fsPath: string }) => { fs.mkdirSync(uri.fsPath, { recursive: true }) }),
    writeFile: vi.fn(async (uri: { fsPath: string }, content: Uint8Array) => { fs.writeFileSync(uri.fsPath, content) }),
  },
}

// ---------------------------------------------------------------------------
// commands / languages / extensions / env
// ---------------------------------------------------------------------------

export const commands = {
  registerCommand: vi.fn((commandId: string, handler: CommandHandler) => {
    commandRegistry.set(commandId, handler)
    return { dispose: () => commandRegistry.delete(commandId) }
  }),
  executeCommand: vi.fn(async (commandId: string, ...args: unknown[]) => {
    const handler = commandRegistry.get(commandId)
    return handler ? handler(...args) : undefined
  }),
}

export const languages = {
  createDiagnosticCollection: vi.fn((_name?: string) => {
    const store = new Map<string, Diagnostic[]>()
    return {
      set: vi.fn((uri: { fsPath: string }, diags: Diagnostic[]) => { store.set(uri.fsPath, diags) }),
      delete: vi.fn((uri: { fsPath: string }) => { store.delete(uri.fsPath) }),
      forEach: vi.fn((cb: (uri: unknown, diags: Diagnostic[]) => void) => { for (const [k, v] of store) cb(Uri.file(k), v) }),
      dispose: vi.fn(),
    }
  }),
  registerDocumentLinkProvider: vi.fn((_selector: unknown, _provider: unknown) => ({ dispose: vi.fn() })),
  registerCodeActionsProvider: vi.fn((_selector: unknown, _provider: unknown, _metadata?: unknown) => ({ dispose: vi.fn() })),
}

/** Test-only: makes `extensions.getExtension(id)` resolve to `value` (default: every id resolves undefined, matching "no git extension in this sandbox" — copyDeepLink-class handlers must survive that, not depend on it). */
export function setExtension(id: string, value: unknown): void {
  extensionOverrides.set(id, value)
}
const extensionOverrides = new Map<string, unknown>()

export const extensions = {
  getExtension: vi.fn((id: string) => extensionOverrides.get(id)),
}

export const env = {
  clipboard: {
    writeText: vi.fn(async (_text: string) => undefined),
    readText: vi.fn(async () => ''),
  },
  openExternal: vi.fn(async (_uri: unknown) => true),
}

export const window = mockWindow
export const workspace = mockWorkspace

export default {
  Position, Range, Selection, RelativePattern, EventEmitter, Uri,
  TreeItemCollapsibleState, StatusBarAlignment, DiagnosticSeverity, CodeActionKind, ViewColumn, TextEditorRevealType,
  TreeItem, ThemeIcon, ThemeColor, Diagnostic, CodeAction, WorkspaceEdit,
  window, workspace, commands, languages, extensions, env,
}
