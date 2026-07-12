/**
 * "New Seed" creation template — single-source discipline.
 *
 * Jérémie's observation (2026-07-12): "I'm not sure the 'new seed' [command]
 * in the extension is the most up-to-date seed-template.md." He was right —
 * this function had drifted from docs/adr/templates/seed-template.md (a
 * thinner "## Thread" section with no worked example, a slightly different
 * Brain Dump instruction, a typo in the Derived Into note).
 *
 * Reading the template file from disk at creation time was considered and
 * rejected: this function runs inside an installed extension operating on
 * an arbitrary user's workspace, which has no reason to contain
 * docs/adr/templates/seed-template.md — only THIS repository (the
 * extension's own source, dogfooding itself) does. Embedding is
 * deliberate, not an oversight. The regression test that keeps it honest
 * (src/test/seedTemplate.test.ts) diffs this function's output against
 * the template file's actual content, so drift fails loudly instead of
 * silently reappearing the next time either one is edited.
 *
 * Vscode-import-free by design — extension.ts imports 'vscode' at module
 * load time, which makes it untestable outside a real extension host; this
 * file has no such import, so it's directly testable.
 */

export function generateSeedTemplate(title: string, date: string, humanName: string): string {
  return `# SEED: ${title}

- **Date**: ${date}
- **From**: ${humanName}

---

## Brain Dump

[Your stream of consciousness here - no structure needed. Just dump your thoughts, ideas, questions, code snippets, frustrations, inspirations, whatever is on your mind about this topic.]

---

**Model Response Request:**

- [ ] Chunk this into ADRs (I'm ready to formalize)
- [ ] Iterate with me (keep exploring)
- [ ] Structure in place (organize but don't split)

---

## Thread

### [Model Name] - [Date]

[Model's response goes here]

---

**Model Response Request:**

- [ ] Chunk this into ADRs
- [ ] Iterate with me
- [ ] Structure in place

### [Your Name] - [Date]

[Your response if continuing]

---

**Instructions for Model:** Copy everything from "Model Response Request" through the final \`---\` to the end of your response.

---

## Derived Into

*(This seed has not yet been chunked into ADRs)*

<!-- When this seed is processed, the AI should update this section with:
- ADR-NNNN: Brief title
- ADR-NNNN: Brief title

If anything in the seed remains unprocessed, make a note of what has not been processed yet at the end of this section.
-->
`
}
