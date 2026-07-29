/**
 * Sidebar category order (2026-07-29 feedback seed, item B): Jérémie's ask
 * for a configurable Tours/ADRs/Seeds order, default Tours-ADRs-Seeds.
 * orderCategories must never DROP a category from the tree just because the
 * setting is missing, malformed, or an incomplete subset.
 */

import { describe, it, expect } from 'vitest'
import { orderCategories, DEFAULT_CATEGORY_ORDER } from '../views/categoryOrder'

describe('orderCategories', () => {
  it('the default order is Tours, ADRs, Seeds', () => {
    expect(DEFAULT_CATEGORY_ORDER).toEqual(['tours', 'adrs', 'seeds'])
  })

  it('applies the default order when all three are present', () => {
    expect(orderCategories(DEFAULT_CATEGORY_ORDER, ['adrs', 'seeds', 'tours'])).toEqual(['tours', 'adrs', 'seeds'])
  })

  it('respects a custom order', () => {
    expect(orderCategories(['seeds', 'adrs', 'tours'], ['adrs', 'seeds', 'tours'])).toEqual(['seeds', 'adrs', 'tours'])
  })

  it('omits a category not present, without disturbing the relative order of the rest', () => {
    // No seeds/tours minted yet — only 'adrs' is present regardless of what the setting says.
    expect(orderCategories(DEFAULT_CATEGORY_ORDER, ['adrs'])).toEqual(['adrs'])
  })

  it('a setting missing a present category appends it at the end, never drops it', () => {
    expect(orderCategories(['adrs'], ['adrs', 'seeds', 'tours'])).toEqual(['adrs', 'seeds', 'tours'])
  })

  it('an empty array setting falls back to present-order, never an empty tree', () => {
    expect(orderCategories([], ['adrs', 'seeds', 'tours'])).toEqual(['adrs', 'seeds', 'tours'])
  })

  it('undefined/null setting falls back to present-order', () => {
    expect(orderCategories(undefined, ['adrs', 'seeds'])).toEqual(['adrs', 'seeds'])
    expect(orderCategories(null, ['adrs', 'seeds'])).toEqual(['adrs', 'seeds'])
  })

  it('a garbled setting (wrong type, unrecognized strings) is filtered out, never crashes or drops a category', () => {
    expect(orderCategories('not-an-array', ['adrs', 'seeds'])).toEqual(['adrs', 'seeds'])
    expect(orderCategories(['bogus', 'adrs', 42, 'seeds'], ['adrs', 'seeds'])).toEqual(['adrs', 'seeds'])
  })

  it('a duplicate entry in the setting is not applied twice', () => {
    expect(orderCategories(['seeds', 'seeds', 'adrs'], ['adrs', 'seeds'])).toEqual(['seeds', 'adrs'])
  })
})
