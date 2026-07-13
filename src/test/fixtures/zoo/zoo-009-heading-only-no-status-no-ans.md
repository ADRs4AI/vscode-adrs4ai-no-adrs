# ADR 0009: Multi-Client Transport Compatibility

- **Date**: 2026-04-18
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

---

## Open Questions

<!-- Deviation: genuinely open questions with a real QST heading but NO Status field
     and NO ANS block anywhere — pure heading-only signal. Confirmed still-open by
     the source ADR's own "Next Steps" section calling for future testing. -->
### QST: Does OpenAI require the /sse/ path specifically?

- Can it use /mcp if configured correctly?
- Is this a hard requirement or just convention?

### QST: Does a trailing slash matter?

- /sse/ vs /sse
- Does the server framework handle both?
