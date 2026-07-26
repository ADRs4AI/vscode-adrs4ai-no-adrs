/**
 * Webview execution harness — actually RUNS the `<script>` block embedded in
 * `openQuestionsPanel.ts`'s template string, instead of regex-checking that
 * certain substrings are present (webview.test.ts's existing "structural"
 * tests). Built for DEBRIEF-004 (Quarry 5, write-adversary seat), per
 * Lapidary's 2026-07-07 design request: shared infrastructure, not
 * adversary-private, since Fitter/Flint will want the same harness the
 * moment they see it.
 *
 * Scope note: the webview side never imports `vscode` — it only talks to
 * `acquireVsCodeApi()` (postMessage/getState/setState) and the DOM. So this
 * harness needs a fake DOM + fake webview API, NOT a fake `vscode` module.
 * The extension-host side (`writeAnswer`, `changeAdrStatus`, real
 * `vscode.workspace.*` calls) is a separate, heavier problem this harness
 * does not attempt to solve.
 *
 * Implementation: extract the script text (same regex as webview.test.ts),
 * run it in a `node:vm` context seeded with a minimal generic fake DOM
 * (every element supports the property surface the script actually uses —
 * .value/.textContent/.innerHTML/.disabled/.style/.dataset/.classList/
 * .addEventListener/.focus/.querySelector/.scrollIntoView) plus a fake
 * `acquireVsCodeApi()`. Real `setTimeout`/`clearTimeout`/`Date` are passed
 * through so `vi.useFakeTimers()` in the calling test controls the panel's
 * debounce (500ms draft autosave) and focus-delay (50ms) deterministically.
 *
 * Escaping gotcha (found 2026-07-13, Fitter 5, while writing a hard-wrap
 * rendering test): the extracted `<script>` text is read from the RAW `.ts`
 * SOURCE FILE — it is never evaluated as the template literal it actually
 * is inside `getHtml()`. Every regex in the script that needs a backslash
 * escape (`\s`, `\d`, `\-`, `` \` ``, etc.) is written DOUBLED in the source
 * (`\\s`, `\\d`, ...) so that it survives being embedded in `getHtml()`'s
 * own outer template literal — real evaluation collapses `\\x` to `\x`,
 * which is what the browser's JS engine needs to see. Extracting the raw
 * text and handing it straight to `vm.Script` skips that collapse: `\\s`
 * reaches the vm as two literal backslash characters followed by `s`, not
 * the whitespace character class — silently changing what several regexes
 * in the script actually match (discovered via a list-detection regex,
 * `[\\-\\*]`, which stopped matching a literal hyphen entirely under this
 * harness while working correctly in the real extension). Fixed by letting
 * the JS engine itself perform the same unescaping a template literal would
 * (wrap the extracted text in backticks and evaluate it) rather than
 * hand-rolling the escape rules — guaranteed fidelity with whatever `getHtml()`
 * actually produces, no risk of the harness's rules drifting from the
 * language's.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const PANEL_SRC = readFileSync(resolve(__dirname, '../../webview/openQuestionsPanel.ts'), 'utf8')

/**
 * Collapses the doubled-backslash escapes in the raw-extracted script text
 * exactly as evaluating it inside its real template literal would, by
 * asking the JS engine to do it: wrap the text in backticks and evaluate.
 * Safe only because the script block itself contains no `${...}` interpolation
 * and every literal backtick inside it is already escaped as `` \` `` (both
 * verified — see this file's header comment) — those are exactly the two
 * things that would make this trick unsafe, and neither is true here.
 */
function unescapeAsTemplateLiteral(rawScriptText: string): string {
  const templateSource = '`' + rawScriptText + '`'
  return vm.runInNewContext(templateSource, {})
}

export interface FakeElement {
  /** Stamped to match the id it was looked up by — real delegated-click handlers read `e.target.id` to dispatch (e.g. openQuestionsPanel.ts's `#draft-restored` links), and this must match for those handlers to fire in a test. */
  id: string
  value: string
  textContent: string
  innerHTML: string
  disabled: boolean
  dataset: Record<string, string>
  style: Record<string, string>
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean }
  addEventListener: (type: string, handler: (e: unknown) => void) => void
  focus: () => void
  scrollIntoView: () => void
  querySelector: (sel: string) => FakeElement | null
  closest: (sel: string) => FakeElement | null
  listeners: Record<string, Array<(e: unknown) => void>>
}

function makeFakeElement(id: string): FakeElement {
  const el: FakeElement = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: (type, handler) => {
      ;(el.listeners[type] ??= []).push(handler)
    },
    focus: () => {},
    scrollIntoView: () => {},
    querySelector: () => null,
    closest: () => null,
    listeners: {},
  }
  return el
}

export interface WebviewHarness {
  /** Fire the `window.addEventListener('message', ...)` handler with a fake MessageEvent. */
  postToWebview(data: Record<string, unknown>): void
  /** Click a button/element by id (invokes its registered 'click' listeners). */
  click(id: string): void
  /**
   * Click a link/button rendered INSIDE a delegated-click container (e.g.
   * openQuestionsPanel.ts's `#draft-restored` div, whose links are
   * innerHTML-rendered per render() call, not individually
   * addEventListener'd). Invokes `parentId`'s own 'click' listeners with
   * `e.target.id === targetId`, matching how the real script's delegated
   * handlers read `e.target.id` to dispatch.
   */
  clickDelegated(parentId: string, targetId: string): void
  /** Type into the answer textarea, firing its 'input' listener (drives the debounced autosave). */
  typeAnswer(text: string): void
  /** Read a fake element's current state (for assertions). */
  element(id: string): FakeElement
  /** All messages the script has posted back to the extension via vscode.postMessage. */
  sentMessages: Array<Record<string, unknown>>
  /** The sandboxed globals — escape hatch for anything not covered above. */
  sandbox: Record<string, unknown>
}

/**
 * Build a fresh harness: extracts and executes the webview `<script>` block
 * in an isolated vm context. Call once per test (module-level `let`/`idx`
 * state in the real script would otherwise leak between tests).
 */
export function createWebviewHarness(): WebviewHarness {
  const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('webviewHarness: could not extract <script> block from openQuestionsPanel.ts')
  const scriptContent = unescapeAsTemplateLiteral(match[1])

  const elements = new Map<string, FakeElement>()
  const getElementById = (id: string): FakeElement => {
    let el = elements.get(id)
    if (!el) { el = makeFakeElement(id); elements.set(id, el) }
    return el
  }

  const documentListeners: Record<string, Array<(e: unknown) => void>> = {}
  const fakeDocument = {
    getElementById,
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      ;(documentListeners[type] ??= []).push(handler)
    },
  }

  const windowListeners: Record<string, Array<(e: unknown) => void>> = {}
  let messageHandler: ((e: { data: Record<string, unknown> }) => void) | undefined
  const fakeWindow = {
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      ;(windowListeners[type] ??= []).push(handler)
      if (type === 'message') messageHandler = handler as typeof messageHandler
    },
  }

  const sentMessages: Array<Record<string, unknown>> = []
  let vsCodeState: Record<string, unknown> = {}
  const fakeAcquireVsCodeApi = () => ({
    postMessage: (msg: Record<string, unknown>) => { sentMessages.push(msg) },
    getState: () => vsCodeState,
    setState: (s: Record<string, unknown>) => { vsCodeState = s },
  })

  const sandbox: Record<string, unknown> = {
    document: fakeDocument,
    window: fakeWindow,
    acquireVsCodeApi: fakeAcquireVsCodeApi,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    console,
  }
  vm.createContext(sandbox)
  new vm.Script(scriptContent).runInContext(sandbox)

  return {
    postToWebview(data) {
      if (!messageHandler) throw new Error('webviewHarness: script never registered a window "message" listener')
      messageHandler({ data })
    },
    click(id) {
      const el = getElementById(id)
      for (const handler of el.listeners['click'] ?? []) handler({ preventDefault: () => {}, target: el })
    },
    clickDelegated(parentId, targetId) {
      const parent = getElementById(parentId)
      const target = getElementById(targetId)
      for (const handler of parent.listeners['click'] ?? []) handler({ preventDefault: () => {}, target })
    },
    typeAnswer(text) {
      const el = getElementById('ans')
      el.value = text
      for (const handler of el.listeners['input'] ?? []) handler({})
    },
    element: getElementById,
    sentMessages,
    sandbox,
  }
}
