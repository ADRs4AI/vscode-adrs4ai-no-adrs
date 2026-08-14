/**
 * Real behavioral tests for computeRootCaptions (Gleaner's brief, 2026-08-14,
 * item A — Jérémie's own caption-mode spec). Pure module, no vscode import.
 */

import { describe, it, expect } from 'vitest'
import { computeRootCaptions, type CaptionInput } from '../views/rootCaption'

const ios = { namespace: 'ios-client-fallback', gitRemoteSlug: { owner: 'jlumbroso', repo: 'ios-client' } }
const pneumatic = { namespace: 'pneumatic-fallback', gitRemoteSlug: { owner: 'jlumbroso', repo: 'pneumatic' } }
const thirdParty = { namespace: 'vendored-fallback', gitRemoteSlug: { owner: 'someorg', repo: 'vendored-lib' } }
const noRemote: CaptionInput = { namespace: 'local-only-project' }

describe('computeRootCaptions', () => {
  it('git-slugs: always owner/repo, regardless of collisions', () => {
    expect(computeRootCaptions([ios, pneumatic], 'git-slugs')).toEqual(['jlumbroso/ios-client', 'jlumbroso/pneumatic'])
  })

  it('git-repo-names: always the bare repo name', () => {
    expect(computeRootCaptions([ios, pneumatic], 'git-repo-names')).toEqual(['ios-client', 'pneumatic'])
  })

  it('git-auto: all roots share one owner — bare repo name for everyone (Jérémie: "just repo name if all owners are the same")', () => {
    expect(computeRootCaptions([ios, pneumatic], 'git-auto')).toEqual(['ios-client', 'pneumatic'])
  })

  it('git-auto: a minority owner gets owner/repo, the majority owner stays bare (Jérémie: "only owner to disambiguate the non-majority")', () => {
    expect(computeRootCaptions([ios, pneumatic, thirdParty], 'git-auto')).toEqual([
      'ios-client',
      'pneumatic',
      'someorg/vendored-lib',
    ])
  })

  it('git-auto: a tied owner count breaks alphabetically, so the result is independent of scan order', () => {
    const a = { namespace: 'a', gitRemoteSlug: { owner: 'alice', repo: 'repo-a' } }
    const b = { namespace: 'b', gitRemoteSlug: { owner: 'bob', repo: 'repo-b' } }
    expect(computeRootCaptions([a, b], 'git-auto')).toEqual(['repo-a', 'bob/repo-b'])
    expect(computeRootCaptions([b, a], 'git-auto')).toEqual(['bob/repo-b', 'repo-a'])
  })

  it('falls back to namespace when there is no discoverable git remote at all, in every mode', () => {
    expect(computeRootCaptions([noRemote], 'git-slugs')).toEqual(['local-only-project'])
    expect(computeRootCaptions([noRemote], 'git-repo-names')).toEqual(['local-only-project'])
    expect(computeRootCaptions([noRemote], 'git-auto')).toEqual(['local-only-project'])
  })

  it('output length always matches input length, even for an empty list', () => {
    expect(computeRootCaptions([], 'git-auto')).toEqual([])
  })
})
