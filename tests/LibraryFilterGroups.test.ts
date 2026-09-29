// Run via `npm test`, which sets TSX_TSCONFIG_PATH so Sidebar JSX and @/ aliases resolve.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { Window } from 'happy-dom'
import type { LibraryFilter } from '../src/lib/types.ts'

const FILTERS: LibraryFilter[] = [
  'installed',
  'deactivated',
  'uninstalled',
  'vf',
  'static',
  'source',
  'no-source',
  'computer',
  'adobe',
  'no-destination',
  'otf',
  'ttf',
]

const dom = new Window({ url: 'http://127.0.0.1:43181/' })
const globals = {
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  SVGElement: dom.SVGElement,
  Element: dom.Element,
  Node: dom.Node,
  DocumentFragment: dom.DocumentFragment,
  navigator: dom.navigator,
  localStorage: dom.localStorage,
  MutationObserver: dom.MutationObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
}
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { LibraryFilterGroups } = await import('../src/components/Sidebar.tsx')

const counts = Object.fromEntries(FILTERS.map((id) => [id, 1])) as Record<LibraryFilter, number>

function clearButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) =>
    /×\s*Clear/.test(button.textContent ?? ''),
  ) as HTMLButtonElement | undefined
}

function pressedFilters(): string[] {
  return [...document.querySelectorAll('button[aria-pressed="true"]')].map(
    (button) => button.getAttribute('aria-label') ?? '',
  )
}

function Harness({ initial }: { initial: LibraryFilter[] }) {
  const [filters, setFilters] = React.useState(initial)
  return React.createElement(LibraryFilterGroups, {
    libraryFilters: filters,
    libraryFilterCounts: counts,
    onLibraryFiltersChange: setFilters,
  })
}

test('clear filters is hidden with none selected, shown when any are on, and click clears all', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { key: 'none', initial: [] }))
  })
  assert.equal(clearButton(), undefined)
  assert.deepEqual(pressedFilters(), [])

  await React.act(async () => {
    root.render(React.createElement(Harness, { key: 'one', initial: ['installed'] }))
  })
  const one = clearButton()
  assert.ok(one, 'expected × Clear when one filter is selected')
  assert.equal(one.parentElement?.className.includes('justify-end'), true)
  assert.deepEqual(pressedFilters(), ['Filter installed'])

  await React.act(async () => {
    root.render(
      React.createElement(Harness, {
        key: 'many',
        initial: ['installed', 'vf', 'source', 'computer', 'otf'],
      }),
    )
  })
  const many = clearButton()
  assert.ok(many, 'expected × Clear when several filters are selected')
  assert.deepEqual(pressedFilters().sort(), [
    'Filter computer',
    'Filter installed',
    'Filter otf',
    'Filter source',
    'Filter vf',
  ])

  await React.act(async () => {
    many.click()
  })
  assert.equal(clearButton(), undefined)
  assert.deepEqual(pressedFilters(), [])

  await React.act(async () => {
    root.unmount()
  })
})

after(() => {
  dom.close()
})
