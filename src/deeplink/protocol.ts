/**
 * Deep Link Protocol
 *
 * Implements ADR-0008's split between local human shorthands
 * (`adr:0008#decision`, `seed:2026-03-04-foo`) and canonical
 * machine references (`adr://v1/project/foo/adr/0008#decision`).
 *
 * Conformance to ADR-0008's grammar is checked mechanically, not by
 * convention: src/test/deeplinkProtocol.test.ts hashes the exact grammar
 * block from docs/adr/0008-deep-link-protocol.md and fails loudly if it
 * changes underneath this file. If that test fails, the grammar moved —
 * update this file, then update the stored hash.
 */

import * as path from 'path'

export type DeepLinkArtifact = 'adr' | 'seed'
export type DeepLinkScope = 'local' | 'project' | 'repo'
export type DeepLinkFormat = 'local-adr' | 'local-seed' | 'xproject-alias' | 'canonical'

export interface ParsedDeepLink {
  raw: string
  format: DeepLinkFormat
  scope: DeepLinkScope
  artifact: DeepLinkArtifact
  namespace?: string
  owner?: string
  repo?: string
  number?: number
  numberText?: string
  subpath?: string
  seedSlug?: string
  anchor?: string
  ref?: string
  iter?: number
}

export interface BuildAdrRefOptions {
  number: number
  anchor?: string
  subpath?: string
}

export interface BuildCanonicalRefOptions {
  scope: Exclude<DeepLinkScope, 'local'>
  artifact: DeepLinkArtifact
  namespace?: string
  owner?: string
  repo?: string
  number?: number
  seedSlug?: string
  subpath?: string
  anchor?: string
  ref?: string
  iter?: number
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
const NUMBER_RE = /^[0-9]+$/
const LOCAL_ADR_RE = /^adr:([^#?]+)(?:#([a-z0-9][a-z0-9-]*))?$/
const LOCAL_SEED_RE = /^seed:([^#?]+)(?:#([a-z0-9][a-z0-9-]*))?$/
const XPROJECT_RE = /^([a-z0-9][a-z0-9-]*)\.([^#?]+)(?:#([a-z0-9][a-z0-9-]*))?$/

export function formatAdrNumber(number: number): string {
  return String(number).padStart(4, '0')
}

export function normalizeSlashPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/')
  return normalized || undefined
}

export function seedSlugFromPath(filePath: string): string {
  return path.basename(filePath, '.md').replace(/^seed-/i, '')
}

export function buildLocalAdrRef(opts: BuildAdrRefOptions): string {
  const locator = [normalizeSlashPath(opts.subpath), formatAdrNumber(opts.number)]
    .filter(Boolean)
    .join('/')
  return appendAnchor(`adr:${locator}`, opts.anchor)
}

export function buildLocalSeedRef(seedSlug: string, anchor?: string): string {
  return appendAnchor(`seed:${seedSlug}`, anchor)
}

export interface BuildXProjectAdrRefOptions {
  namespace: string
  number: number
  anchor?: string
  subpath?: string
}

/**
 * Cross-project alias ref (ADR-0008's own XPROJECT_RE grammar,
 * `{namespace}.{locator}#{anchor}` — parseXProjectAlias above already
 * reads this shape; this is its missing write-side counterpart). ADR-
 * 0025 Decision 7's "shortest form that will disambiguate at the
 * destination": a bare `adr:NNNN` copied from a multi-root workspace
 * would resolve against WHICHEVER root the paste lands in, not
 * necessarily the root it was copied from — silently wrong, not just
 * ambiguous, if pasted into a different root's document. No such alias
 * exists for seeds in this grammar (XPROJECT_RE only ever resolves an
 * ADR locator) — buildCanonicalRef (scope 'project', artifact 'seed')
 * is the correct, already-ratified fallback there, not an invented
 * extension to this one.
 */
export function buildXProjectAdrRef(opts: BuildXProjectAdrRefOptions): string {
  const locator = [normalizeSlashPath(opts.subpath), formatAdrNumber(opts.number)]
    .filter(Boolean)
    .join('/')
  return appendAnchor(`${opts.namespace}.${locator}`, opts.anchor)
}

export function buildCanonicalRef(opts: BuildCanonicalRefOptions): string {
  const scopePath = buildScopePath(opts)
  const locator = buildLocator(opts)
  const params = new URLSearchParams()
  if (opts.ref) params.set('ref', opts.ref)
  if (typeof opts.iter === 'number') params.set('iter', String(opts.iter))
  const query = params.toString()
  const base = `adr://v1/${scopePath}/${opts.artifact}/${locator}${query ? `?${query}` : ''}`
  return appendAnchor(base, opts.anchor)
}

export function parseDeepLinkRef(raw: string): ParsedDeepLink | undefined {
  const ref = raw.trim()
  return parseCanonicalRef(ref)
    ?? parseLocalAdrRef(ref)
    ?? parseLocalSeedRef(ref)
    ?? parseXProjectAlias(ref)
}

export function parseAdrLocator(locator: string): Pick<ParsedDeepLink, 'number' | 'numberText' | 'subpath'> | undefined {
  const parts = normalizeSlashPath(locator)?.split('/') ?? []
  if (parts.length === 0) return undefined
  const numberText = parts[parts.length - 1]
  if (!NUMBER_RE.test(numberText)) return undefined
  const subpath = parts.length > 1 ? parts.slice(0, -1).join('/') : undefined
  return {
    number: parseInt(numberText, 10),
    numberText,
    subpath,
  }
}

function parseLocalAdrRef(ref: string): ParsedDeepLink | undefined {
  const match = ref.match(LOCAL_ADR_RE)
  if (!match) return undefined
  const locator = parseAdrLocator(match[1])
  if (!locator) return undefined
  return {
    raw: ref,
    format: 'local-adr',
    scope: 'local',
    artifact: 'adr',
    ...locator,
    anchor: match[2],
  }
}

function parseLocalSeedRef(ref: string): ParsedDeepLink | undefined {
  const match = ref.match(LOCAL_SEED_RE)
  if (!match) return undefined
  return {
    raw: ref,
    format: 'local-seed',
    scope: 'local',
    artifact: 'seed',
    seedSlug: normalizeSlashPath(match[1]),
    anchor: match[2],
  }
}

function parseXProjectAlias(ref: string): ParsedDeepLink | undefined {
  const match = ref.match(XPROJECT_RE)
  if (!match) return undefined
  const locator = parseAdrLocator(match[2])
  if (!locator) return undefined
  return {
    raw: ref,
    format: 'xproject-alias',
    scope: 'project',
    artifact: 'adr',
    namespace: match[1],
    ...locator,
    anchor: match[3],
  }
}

function parseCanonicalRef(ref: string): ParsedDeepLink | undefined {
  if (!ref.startsWith('adr://')) return undefined

  let url: URL
  try {
    url = new URL(ref)
  } catch {
    return undefined
  }
  if (url.protocol !== 'adr:' || url.hostname !== 'v1') return undefined

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length < 3) return undefined

  const scopeKind = parts[0]
  let scope: Exclude<DeepLinkScope, 'local'>
  let namespace: string | undefined
  let owner: string | undefined
  let repo: string | undefined
  let artifactIdx: number

  if (scopeKind === 'project') {
    if (parts.length < 4) return undefined
    scope = 'project'
    namespace = parts[1]
    artifactIdx = 2
  } else if (scopeKind === 'repo') {
    if (parts.length < 5) return undefined
    scope = 'repo'
    owner = parts[1]
    repo = parts[2]
    artifactIdx = 3
  } else {
    return undefined
  }

  const artifactRaw = parts[artifactIdx]
  if (artifactRaw !== 'adr' && artifactRaw !== 'seed') return undefined
  const artifact = artifactRaw as DeepLinkArtifact

  const locator = parts.slice(artifactIdx + 1).join('/')
  if (!locator) return undefined

  const common = {
    raw: ref,
    format: 'canonical' as const,
    scope,
    artifact,
    namespace,
    owner,
    repo,
    anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined,
    ref: url.searchParams.get('ref') ?? undefined,
    iter: parseIter(url.searchParams.get('iter')),
  }

  if (artifact === 'adr') {
    const parsedLocator = parseAdrLocator(locator)
    if (!parsedLocator) return undefined
    return { ...common, ...parsedLocator }
  }

  return {
    ...common,
    seedSlug: normalizeSlashPath(locator),
  }
}

function buildScopePath(opts: BuildCanonicalRefOptions): string {
  if (opts.scope === 'project') {
    if (!opts.namespace || !SLUG_RE.test(opts.namespace)) {
      throw new Error('Canonical project references require a slug namespace.')
    }
    return `project/${encodeURIComponent(opts.namespace)}`
  }

  // Founder Report, 2026-09-02/05 (real crash, every copyDeepLink call in
  // THIS repo): `owner`/`repo` come from a real git remote URL
  // (gitRemoteSlugFor, case-preserved for display), not a tool-chosen
  // slug — GitHub org/repo names allow mixed case (this repo's own remote
  // is "ADRs4AI/vscode-adrs4ai"), and SLUG_RE is lowercase-only. Lower-
  // casing here (not at the gitRemoteSlug source, which stays real-cased
  // for the tree/panel caption) keeps the canonical form both crash-free
  // and stable/unique — GitHub itself resolves "ADRs4AI" and "adrs4ai" to
  // the same repo, so two differently-cased refs to the same repo now
  // produce the identical canonical string instead of one throwing.
  const owner = opts.owner?.toLowerCase()
  const repo = opts.repo?.toLowerCase()
  if (!owner || !repo || !SLUG_RE.test(owner) || !SLUG_RE.test(repo)) {
    throw new Error('Canonical repo references require slug owner and repo.')
  }
  return `repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function buildLocator(opts: BuildCanonicalRefOptions): string {
  const subpath = normalizeSlashPath(opts.subpath)
  if (opts.artifact === 'adr') {
    if (typeof opts.number !== 'number') {
      throw new Error('ADR canonical references require a number.')
    }
    return [subpath, formatAdrNumber(opts.number)]
      .filter(Boolean)
      .map(part => part!.split('/').map(encodeURIComponent).join('/'))
      .join('/')
  }

  if (!opts.seedSlug) {
    throw new Error('Seed canonical references require a seedSlug.')
  }
  return [subpath, opts.seedSlug]
    .filter(Boolean)
    .map(part => part!.split('/').map(encodeURIComponent).join('/'))
    .join('/')
}

function appendAnchor(base: string, anchor: string | undefined): string {
  if (!anchor) return base
  return `${base}#${encodeURIComponent(anchor)}`
}

function parseIter(value: string | null): number | undefined {
  if (!value || !/^[0-9]+$/.test(value)) return undefined
  return parseInt(value, 10)
}
