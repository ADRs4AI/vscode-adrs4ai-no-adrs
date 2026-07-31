<!--
Real specimen, pinned verbatim (not synthesized). Source:
batch-renderer/docs/adr/0003-compatibility-mode-and-templates.md:432-503
("Headers pattern tree structure details (Iteration 3 from Claude)").

Captured 2026-07-31 at Jérémie's direct request ("Gleaner: Capture the
original ADR in regression testing as it has a lot of problems") after
three founder Reports on this exact question: code fences and nested
sub-bullets leaking as literal "CODE1"/"CODE2" text and flattening into
run-on paragraphs in the Open Questions panel (openQuestionsPanel.ts's
renderMarkdown(), QST-DETECTION-LEDGER's OPEN "no concept of block-level
content nested inside a list item" row), then a follow-up Report reading
the resulting garbled question body as "ANS detection completely fails."

Checked and ruled out (Gleaner 5, scripts/ephemeral/2026-07-31-gleaner-
probe-batchrenderer-adr0003-ans-detection.ts): the core parser
(parseAdr) extracts this question correctly — isAnswered: true,
answer.text the full real answer, no warnings. The defect is entirely
in the panel's renderMarkdown(), not in extraction. This fixture is for
whoever fixes that renderer: feed the "Understanding your tree vision"
block + numbered list below through renderMarkdown() and confirm no
"CODE" placeholder leaks and no list item swallows its siblings.
-->

### QST: Headers pattern tree structure details (Iteration 3 from Claude)

- Status: answered
- Why asking: Tree structure vision needs implementation details (path formatting, multi-level text, numbering, edge cases)
- Need: clarification on structure and edge cases

**Understanding your tree vision:**
```markdown
# Section 1
Some intro text here?

## Subsection A
First prompt text

## Subsection B
Second prompt text

# Section 2
## Another subsection
Third prompt text
```

**Questions about implementation:**

1. **Path formatting** - How should the tree path become the filename/folder?
   ```
   Option A: Nested folders matching tree
   out/section-1/subsection-a/prompt.png
   out/section-1/subsection-b/prompt.png

   Option B: Flat with path in filename
   out/section-1-subsection-a.png
   out/section-1-subsection-b.png

   Option C: Hybrid (section folders, subsection in name)
   out/section-1/subsection-a.png
   ```
2. **Text at multiple levels** - What if there's text under h1 AND h2?
   ```markdown
   # Main Title
   This is text at h1 level - is this a prompt?

   ## Subtitle
   This is text at h2 level - is this a prompt?
   ```
   Should both become prompts? Just the leaf nodes?
3. **Numbering/IDs** - Should we:
   - Number prompts sequentially (1, 2, 3...)?
   - Use tree path as ID ("1.1", "1.2", "2.1")?
   - No numbering, just use titles?
4. **Edge cases:**
   - File with no headers at all, just text - render as single prompt?
   - Empty sections (header with no text) - skip?
   - Multiple paragraphs under one header - combine or separate?

**Recommendation**: (by Compositor 4.5, 2026-07-30 stock-check)

**Option A paths, leaf-node prompts, sequential IDs, combine paragraphs.** Question 1 (path): nested folders (Option A) mirror tree structure, aid navigation. Question 2 (multi-level text): render only leaf nodes (text with no sub-headers) — inner nodes are organizing structure, not prompts. Question 3 (IDs): sequential (1, 2, 3) for simplicity; tree-path IDs ("1.1", "1.2") add complexity without clear benefit for headers mode. Question 4 (edge cases): no headers → single prompt with filename as title; empty sections → skip with warning; multiple paragraphs → combine with `\n\n`. This design aligns with Jérémie's original tree vision ("draw a binary tree where each header is a node...at the leaves there's text"). Consequence if wrong: if inner-node text is also rendered, organizational headers pollute prompt set; if flat paths, tree structure is lost.

**ANS:** (by Jérémie Lumbroso)
After almost half a year of operation we have evolved beyond these guesses, and I'll try to summarize.

1. Yes, as recommended: Nested folders (Option A). I want to provide some additional thinking here. The nested folders allow for generating multiple versions, for calling different models, or different parameters. In other words, it allows a specific prompt configuration to have multiple instanciations. This is part of the **iteration-friendly ethos**, i.e., everything is an opportunity to iterate and try variants.

2. Yes, render only leaf nodes. We have other features, like the tag library, to distribute prompting throughout the document, we don't need any other mechanism.

3. Yes, agreed with the recommendation, but we should be permissive here, like Postel's Law: The initial designs were sometimes too restrictive and led to undetected prompts, frequently (possibly because the template under-emphasized the format's importance and models didn't always follow it).

4. Agreed fully with the (great) recommendations from Compositor here.

---
