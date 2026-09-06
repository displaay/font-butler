import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  LIBRARY_FILTERS_KEY,
  readLibraryFilters,
  readSortMode,
  shouldShowOnboarding,
} from './preferences.ts'
import type { AppSettings } from './types.ts'

const stored = new Map<string, string>()

function installDom(search = '') {
  stored.clear()
  Object.assign(globalThis, {
    window: {
      location: { search },
    },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value)
      },
    },
  })
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { localStorage?: unknown }).localStorage
})

function settings(onboardingCompleted: boolean): AppSettings {
  return { onboardingCompleted } as AppSettings
}

test('shouldShowOnboarding follows the query flag or incomplete setup', () => {
  installDom('')
  assert.equal(shouldShowOnboarding(settings(true)), false)
  assert.equal(shouldShowOnboarding(settings(false)), true)
  installDom('?onboarding=1')
  assert.equal(shouldShowOnboarding(settings(true)), true)
})

test('readSortMode only accepts added or name', () => {
  installDom()
  assert.equal(readSortMode(), 'name')
  stored.set('font-butler-sort', 'added')
  assert.equal(readSortMode(), 'added')
  stored.set('font-butler-sort', 'installed')
  assert.equal(readSortMode(), 'added')
  stored.set('font-butler-sort', 'bogus')
  assert.equal(readSortMode(), 'name')
})

test('readLibraryFilters keeps valid chips and ignores junk', () => {
  installDom()
  assert.deepEqual(readLibraryFilters(), [])
  stored.set(LIBRARY_FILTERS_KEY, JSON.stringify(['installed', 'nope', 'source']))
  assert.deepEqual(readLibraryFilters(), ['installed', 'source'])
  stored.set(LIBRARY_FILTERS_KEY, '{')
  assert.deepEqual(readLibraryFilters(), [])
  stored.set(LIBRARY_FILTERS_KEY, JSON.stringify({ installed: true }))
  assert.deepEqual(readLibraryFilters(), [])
})
