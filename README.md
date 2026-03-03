# Human-AI Collaboration Template A

- **Version**: 3.1
- **Optimized for**: Claude models in general (and Sonnet 4.5 in particular) in Claude Code
- **Created by**: Jérémie Lumbroso & Claude Sonnet 4.5 & Claude Opus 4.1
- **Philosophy**: Preserve conversations, minimize ceremony

I have been collaborating with LLMs since 2022, and I believe they are extremely capable collaborators. Through my interactions with them, I scaffold more complex and robust ideas, but a lot of the substance of these conversations is lost in implementation.

This is where [ADRs (Architectural Decision Records)](https://adr.github.io/) come in: While for a human-only team, they are needlessly verbose, for a human-AI team, they are a perfect vessel for shared decision-making.

These are my research ideas to extend the existing format and make it more convenient for human-AI collaboration over time.

Please send any feedback to lumbroso@seas.upenn.edu

![Human-AI Collaboration Banner](https://raw.githubusercontent.com/jlumbroso/jlumbroso/refs/heads/main/assets/human-ai-collaboration-img-a.jpg)

---

## What This Is

A minimal system for turning conversations into persistent artifacts:
- Capture decisions without bureaucracy
- Structure without constraining
- Persist knowledge across sessions
- Enable continuity between AI instances

---

## Quick Start

### 1. Copy these files to your project:

```
project/
├── CLAUDE.md              # Customize per project (87 lines)
├── docs/
│   ├── adr/
│   │   ├──
│   │   ├── collab-adr-lean.md    # For complex decisions
│   │   ├── template.md           # For simple decisions  
│   │   └── seed-template.md      # For brain dumps
│   └── METHODOLOGY.md     # Read once (reference as needed)
└── [your code]
```

### 2. When you have thoughts:

Create `seed-[topic].md`:
```markdown
# SEED: My Problem

## Brain Dump
[Just dump everything here - no structure needed]

---
**Model**: Please chunk this into ADRs
```

### 3. Tell Claude:

"I've dumped thoughts in seed-[topic].md, please chunk into ADRs"

### 4. Claude will:

- Read your dump
- Identify distinct threads (usually 2-5)
- Create separate ADR for each
- Add navigation codes (QST:, ANS:, etc.)
- Ask clarifying questions

### 5. You answer naturally:

Just fill in the `ANS:` blocks. No special format.

### 6. Iterate together:

- Decisions documented
- Rationale preserved
- Future instances can continue

---

## The Files

### `CLAUDE.md` (87 lines)
Project-specific guidance loaded at each Claude Code session.

**Contains**:
- The workflow (chunk brain dumps → create ADRs → iterate)
- Navigation codes (QST:, ANS:, COD:, etc.)
- Project context (what we're building, current focus)
- Where things are (file structure)
- When to use which template

**Customize** this per project with specific context.

### `METHODOLOGY.md` (read once)
Explains the "why" behind the system.

**Read when**:
- First time using the system
- Onboarding someone new
- You forget why we do something

**Don't read** at every session - it's reference material.

### `collab-adr-lean.md` (template)
For complex decisions needing back-and-forth.

**Use when**:
- Decision has multiple threads
- Need to ask/answer questions
- Want to track iterations
- Complexity requires structure

### `template.md` (standard MADR)
Industry-standard ADR format for simple decisions.

**Use when**:
- Options are clear
- Decision is straightforward
- Standard documentation needed

### `seed-template.md` (12 lines)
For brain dumps that become ADRs.

**Use when**:
- Thoughts are unstructured
- Multiple topics mixed together
- Just need to capture everything

---

## Key Features

### Navigation Codes
Make everything grep-able:
```bash
grep '^### QST:' docs/adr/        # Find all questions
grep 'Status: unanswered' docs/   # Find what needs answers  
grep '^### COD:' docs/adr/         # Find code examples
```

### Stream-of-Consciousness Preservation
- Humans write naturally
- AI adds structure
- Original thinking preserved

### Iteration Tracking
- Changes documented, not hidden
- Evolution visible
- Learning captured

### Clear Workflow
- Human dumps → AI chunks → Both iterate
- Roles are clear
- Process is simple

---

## Success Metrics (Actual)

You know it's working when:
- Important decisions don't disappear
- New AI instances continue seamlessly
- You find past decisions in <10 seconds
- Process feels helpful, not burdensome

You know it's not working when:
- Conversations happen without artifacts
- Process feels like ceremony
- Can't find past decisions
- Repeated explanations needed

---

## For Claude Code Sessions

This system optimized for the reality of Claude Code:
- Files loaded at session start (context cost matters)
- Need to know what to do immediately
- Can't waste tokens on repetition
- Handoffs happen when context fills

- **`CLAUDE.md` tells you**: What to do
- **`METHODOLOGY.md` explains**: Why we do it
- **Templates provide**: Structure when needed

---

## Customization

### For Your Project

1. Copy files to your repo
2. Fill in `CLAUDE.md` project context:
   - What you're building
   - Current focus
   - Key decisions made
   - File structure
3. Use as-is or adapt templates

### For Your Style

Keep what helps, cut what doesn't. Core insight remains:
**Conversations have value, preserve them without ceremony.**

---

## Examples

### Good brain dump:
```markdown
# SEED: Authentication

## Brain Dump

I'm frustrated with our current auth. Session-based is 
annoying for mobile. JWT seems cleaner but what about 
refresh tokens? Also concerned about XSS if we store in 
localStorage. Maybe httpOnly cookies? But then CSRF...

Saw this article [link] about rotation tokens. Makes sense 
but adds complexity. Not sure if worth it for our scale.

Also need to think about social login. Firebase Auth? 
Or roll our own?

**Model**: Please chunk this into ADRs
```

**Result**: Claude creates 3 ADRs:
- ADR-0015: JWT vs Session Authentication
- ADR-0016: Token Storage Strategy
- ADR-0017: Social Login Integration

### Good answer pattern:
```markdown
### QST: Should we use refresh tokens?
- Status: unanswered
- Why asking: Impacts security vs UX tradeoff
- Need: yes/no with reasoning

**ANS:** (by Jérémie)
Yes, use refresh tokens. Security matters more than 
slightly more complex flow. 7-day expiry seems reasonable.
```

---

## Philosophy in One Sentence

**This system treats AI as a cognitive partner who preserves your thinking, not a tool that executes tasks.**

---

## Getting Help

1. Read `METHODOLOGY.md` for the "why"
2. Check `CLAUDE.md` for the "what"
3. Look at templates for the "how"
4. Adapt to your needs

---

## License & Attribution

Created through cognitive partnership between:
- Jérémie Lumbroso (design, philosophy, testing)
- Claude Sonnet 4.5 (implementation, optimization)

Based on ADR methodology by Michael Nygard.

---

*Remember: The system serves the work. If something doesn't help, change it.*
