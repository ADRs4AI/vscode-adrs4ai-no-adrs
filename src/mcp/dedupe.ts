/**
 * Client-message dedup for mutating MCP tools (ADR-0021 conventions,
 * `system3__0022-1b`/`0023` import). Process-lifetime, in-memory — the same
 * scope as `get_diff(since:'last-read')` is already documented to be
 * (ADR-0003 Supporting Materials), and named the same way: Forma-3-only, not
 * a durable exactly-once guarantee. A Forma-5 remote server would need a
 * real store for the same property.
 *
 * Only successful writes are cached. A conflict or validation error is not
 * cached — retrying after fixing the actual problem (or after a refresh)
 * must be able to succeed, not replay a stale failure forever.
 */

const seen = new Map<string, string>()

export function dedupeKey(toolName: string, clientMsgId: string): string {
  return `${toolName}:${clientMsgId}`
}

export function getCached(toolName: string, clientMsgId: string | undefined): string | undefined {
  if (!clientMsgId) return undefined
  return seen.get(dedupeKey(toolName, clientMsgId))
}

export function recordSuccess(toolName: string, clientMsgId: string | undefined, result: string): void {
  if (!clientMsgId) return
  seen.set(dedupeKey(toolName, clientMsgId), result)
}

/** Test-only: clear all cached results between test cases. */
export function _resetDedupeCacheForTests(): void {
  seen.clear()
}
