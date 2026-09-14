/**
 * Structural tests (vscode-import wall — deepLinkUriHandler.ts imports
 * vscode at module scope, same discipline as terminalLinkProviderWiring.
 * test.ts) for the vscode:// URI handler (Plenum's pigeonhole brief,
 * 2026-09-14, charter via Lapidary). The routing DECISION (decideRoute,
 * parseUriHandlerTarget) has real behavioral tests in uriTarget.test.ts;
 * this file only pins that the vscode-touching glue wires that decision
 * to the right side effect, and reuses OPEN_DEEP_LINK_COMMAND rather than
 * re-deriving its open-and-jump / loud-error behavior a third time.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = readFileSync(resolve(__dirname, '../views/deepLinkUriHandler.ts'), 'utf8')
const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('deepLinkUriHandler.ts: handleUri is a CALLER, not a resolver', () => {
  const fn = SRC.match(/async handleUri\(uri: vscode\.Uri\): Promise<void> \{[\s\S]*?\n  \}/)![0]

  it('parses the target via the shared pure parser, no inline query-string logic', () => {
    expect(fn).toContain('parseUriHandlerTarget({ path: uri.path, query: uri.query })')
  })

  it('resolves via the injected resolve function, same ResolveLink shape documentLinkProvider.ts uses', () => {
    expect(fn).toContain('this.deps.resolve(target)')
  })

  it('decides the surface via the shared pure decideRoute, not inline branching on resolved.kind', () => {
    expect(fn).toContain("decideRoute(resolved, openIn)")
  })

  it('a resolved question with route question-dialog opens the panel via the injected callback', () => {
    expect(fn).toContain("route === 'question-dialog' && resolved.kind === 'question'")
    expect(fn).toContain('this.deps.openQuestionDialog(resolved.question.id)')
  })

  it('every non-dialog outcome (markdown route, no tree node, or a failed reveal) falls through to OPEN_DEEP_LINK_COMMAND — no parallel open-file logic', () => {
    expect(fn).toContain("vscode.commands.executeCommand(OPEN_DEEP_LINK_COMMAND, target)")
  })

  it('a failed tree reveal degrades gracefully (catches, does not rethrow) rather than losing the click', () => {
    expect(fn).toMatch(/try \{[\s\S]*?treeView\.reveal\(item[\s\S]*?\} catch \{[\s\S]*?\}/)
  })
})

describe('deepLinkUriHandler.ts: a resolution failure is ledgered (ADR-0035), never silent', () => {
  it("appends a 'uri-handler' source record when resolve() returns an error", () => {
    const fn = SRC.match(/async handleUri\(uri: vscode\.Uri\): Promise<void> \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain("if (resolved.kind === 'error')")
    expect(fn).toContain("source: 'uri-handler'")
    expect(fn).toContain('appendLedgerRecord(')
  })

  it("'uri-handler' is a recognized LedgerRecord source, not a typo the type system would miss", () => {
    const errorLogSrc = readFileSync(resolve(__dirname, '../drafts/errorLog.ts'), 'utf8')
    expect(errorLogSrc).toMatch(/source:[\s\S]*'uri-handler'/)
  })
})

describe('deepLinkUriHandler.ts: treeItemFor builds an identity-only AdrTreeItem per resolved kind', () => {
  const fn = SRC.match(/function treeItemFor\([\s\S]*?\n\}/)![0]

  it('a question resolves to a question-kind tree item', () => {
    expect(fn).toContain("case 'question':")
    expect(fn).toContain("kind: 'question', question: resolved.question")
  })

  it('an ADR and a section (no section-level tree node exists) both reveal the owning ADR item', () => {
    expect(fn).toContain("case 'adr':")
    expect(fn).toContain("case 'section':")
    expect(fn).toContain("kind: 'adr', adr: resolved.adr")
  })

  it('a seed resolves to a seed-kind tree item', () => {
    expect(fn).toContain("case 'seed':")
    expect(fn).toContain("kind: 'seed', seed: resolved.seed")
  })
})

describe('extension.ts: the URI handler is registered at activation with live deps', () => {
  it('imports registerDeepLinkUriHandler', () => {
    expect(EXT_SRC).toContain("import { registerDeepLinkUriHandler } from './views/deepLinkUriHandler'")
  })

  it('registers it with the same resolveLink closure the document/terminal providers use — one resolver, three callers', () => {
    const block = EXT_SRC.match(/registerDeepLinkUriHandler\(\{[\s\S]*?\n    \}\),/)![0]
    expect(block).toContain('resolve: resolveLink')
    expect(block).toContain('treeView')
  })

  it('openQuestionDialog closes over the live compositeIndex, not a snapshot taken at registration time', () => {
    const block = EXT_SRC.match(/registerDeepLinkUriHandler\(\{[\s\S]*?\n    \}\),/)![0]
    expect(block).toContain('OpenQuestionsPanel.createOrShow(compositeIndex)')
    expect(block).toContain('OpenQuestionsPanel.navigateTo(questionId)')
  })
})

describe('package.json: adrManager.deepLink.openIn setting and onUri activation', () => {
  it('the setting exists with the three documented values, defaulting to question-dialog', () => {
    const re = /"adrManager\.deepLink\.openIn":\s*\{[\s\S]*?\n        \}/
    const match = PKG.match(re)
    expect(match, 'adrManager.deepLink.openIn setting missing').toBeTruthy()
    const block = match![0]
    expect(block).toContain('"question-dialog"')
    expect(block).toContain('"tree"')
    expect(block).toContain('"markdown"')
    expect(block).toContain('"default": "question-dialog"')
  })

  it('onUri is declared so a cold-started VS Code activates on an incoming vscode:// link', () => {
    const activation = PKG.match(/"activationEvents":\s*\[[\s\S]*?\]/)![0]
    expect(activation).toContain('"onUri"')
  })
})
