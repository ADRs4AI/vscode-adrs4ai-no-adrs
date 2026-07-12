# Shared test helpers

Infrastructure meant to be reused across test files, not adversary-private
(per Lapidary's 2026-07-07 design note). Put a thing here when a second seat
would plausibly want the same harness.

## `webviewHarness.ts`

Actually **executes** the `<script>` block embedded in
`src/webview/openQuestionsPanel.ts`'s template string, in a `node:vm`
context with a minimal fake DOM + fake `acquireVsCodeApi()`. This is
different from `webview.test.ts`'s existing tests, which only regex-check
that certain substrings are present in the script text — those catch syntax
errors and "did the code for X get removed," but can't catch "does the gate
actually behave correctly across this sequence of messages."

Use it when you need to drive the panel's client-side state machine
(`render()`, the `'questions'`/`'answered'`/`'driftDetected'` message
handlers, skip/back navigation, the draft-autosave debounce) and assert on
the resulting DOM state or on what got posted back to the extension host.

**Scope**: webview-side only. The webview never imports `vscode` — only the
extension-host side (`writeAnswer`, `changeAdrStatus`, real
`vscode.workspace.*` calls) needs an actual `vscode` module mock, which this
harness does not provide. That's a separate, larger problem.

```ts
import { createWebviewHarness } from './helpers/webviewHarness'

const h = createWebviewHarness()
h.postToWebview({ type: 'questions', questions: [...], generation: 0 })
h.typeAnswer('my answer')       // fires the 500ms-debounced autosave input handler
h.click('btn-skip')             // fires the skip button's click handler
expect(h.element('ans').value).toBe('')
expect(h.sentMessages).toContainEqual(expect.objectContaining({ type: 'skip' }))
```

Combine with `vi.useFakeTimers()` to control the 500ms draft-save debounce
and the 50ms post-navigation focus delay deterministically — call
`vi.useFakeTimers()` **before** `createWebviewHarness()` so the harness
captures the faked `setTimeout`/`clearTimeout`.
