import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { applyTheme, resolveTheme, THEME_STORAGE_KEY } from './theme.ts'

const stored = new Map<string, string>()
const classes = new Set<string>()
const style: { colorScheme?: string } = {}

function installDom(prefersDark: boolean) {
  stored.clear()
  classes.clear()
  style.colorScheme = undefined
  Object.assign(globalThis, {
    window: {
      matchMedia: (query: string) => ({
        matches: query.includes('prefers-color-scheme: dark') && prefersDark,
      }),
    },
    document: {
      documentElement: {
        classList: {
          toggle(name: string, force?: boolean) {
            if (force === undefined) {
              if (classes.has(name)) classes.delete(name)
              else classes.add(name)
              return
            }
            if (force) classes.add(name)
            else classes.delete(name)
          },
        },
        style,
      },
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
  delete (globalThis as { document?: unknown }).document
  delete (globalThis as { localStorage?: unknown }).localStorage
})

test('resolveTheme keeps an explicit light or dark choice', () => {
  installDom(true)
  assert.equal(resolveTheme('light'), 'light')
  assert.equal(resolveTheme('dark'), 'dark')
})

test('resolveTheme follows the system preference', () => {
  installDom(true)
  assert.equal(resolveTheme('system'), 'dark')
  installDom(false)
  assert.equal(resolveTheme('system'), 'light')
})

test('applyTheme toggles the dark class and persists the mode', () => {
  installDom(false)
  applyTheme('dark')
  assert.equal(classes.has('dark'), true)
  assert.equal(style.colorScheme, 'dark')
  assert.equal(stored.get(THEME_STORAGE_KEY), 'dark')

  applyTheme('light')
  assert.equal(classes.has('dark'), false)
  assert.equal(style.colorScheme, 'light')
  assert.equal(stored.get(THEME_STORAGE_KEY), 'light')
})

test('applyTheme system uses the current color scheme', () => {
  installDom(true)
  applyTheme('system')
  assert.equal(classes.has('dark'), true)
  assert.equal(style.colorScheme, 'dark')
  assert.equal(stored.get(THEME_STORAGE_KEY), 'system')
})
