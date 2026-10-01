// Run via `npm test`, which sets TSX_TSCONFIG_PATH so Sidebar JSX and @/ aliases resolve.
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverStub,
  configurable: true,
  writable: true,
})

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { LibraryFiltersPanel, Sidebar } = await import('../src/components/Sidebar.tsx')

const groupsOpen = {
  Status: true,
  Type: true,
  Source: true,
  Destination: true,
  Format: true,
}

const counts = Object.fromEntries(FILTERS.map((id) => [id, 1])) as Record<LibraryFilter, number>

function clearButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) =>
    /×\s*Clear/.test(button.textContent ?? '') && button.getAttribute('aria-hidden') !== 'true',
  ) as HTMLButtonElement | undefined
}

function clearButtonSlot(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) =>
    /×\s*Clear/.test(button.textContent ?? ''),
  ) as HTMLButtonElement | undefined
}

function pressedFilters(): string[] {
  return [...document.querySelectorAll('button[aria-pressed="true"]')].map(
    (button) => button.getAttribute('aria-label') ?? '',
  )
}

function buttonByLabel(
  label: string,
  { visibleOnly = false }: { visibleOnly?: boolean } = {},
): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) => {
    if (visibleOnly && button.getAttribute('aria-hidden') === 'true') return false
    return (button.textContent ?? '').includes(label) || button.getAttribute('aria-label') === label
  }) as HTMLButtonElement | undefined
}

function Harness({ initial }: { initial: LibraryFilter[] }) {
  const [filters, setFilters] = React.useState(initial)
  const [filterGroupsOpen, setFilterGroupsOpen] = React.useState(groupsOpen)
  const [filtersPanelOpen, setFiltersPanelOpen] = React.useState(true)
  return React.createElement(LibraryFiltersPanel, {
    libraryFilters: filters,
    libraryFilterCounts: counts,
    onLibraryFiltersChange: setFilters,
    filterGroupsOpen,
    onFilterGroupsOpenChange: setFilterGroupsOpen,
    filtersPanelOpen,
    onFiltersPanelOpenChange: setFiltersPanelOpen,
  })
}

function SidebarHarness() {
  const [tab, setTab] = React.useState<'library' | 'system' | 'activity'>('library')
  return React.createElement(Sidebar, {
    query: '',
    onQueryChange: () => {},
    tab,
    onTabChange: setTab,
    watchFolders: [],
    watchFolderFilter: null,
    watchFolderCounts: {},
    onSelectWatchFolder: () => setTab('library'),
    onRevealWatchFolder: () => {},
    onRemoveWatchFolder: () => {},
    libraryFilters: [],
    libraryFilterCounts: counts,
    onLibraryFiltersChange: () => {},
    counts: { library: 0, system: 0, updates: 0, activity: 0 },
    onOpenSettings: () => {},
  })
}

describe('library filter controls', { concurrency: 1 }, () => {
test('clear filters is hidden with none selected, shown when any are on, and click clears all', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { key: 'none', initial: [] }))
  })
  const clearSlot = clearButtonSlot()
  assert.ok(clearSlot, 'expected × Clear slot in Filters header')
  assert.equal(clearSlot!.getAttribute('aria-hidden'), 'true')
  assert.equal(clearButton(), undefined)
  assert.deepEqual(pressedFilters(), [])

  await React.act(async () => {
    root.render(React.createElement(Harness, { key: 'one', initial: ['installed'] }))
  })
  const one = clearButton()
  assert.ok(one, 'expected × Clear when one filter is selected')
  assert.equal(
    one.closest('.group\\/library-filters') != null,
    true,
    'expected × Clear in the Filters header row',
  )
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

test('the filters panel collapses and hides filter chips', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { initial: [] }))
  })
  assert.ok(buttonByLabel('Installed'), 'expected filters panel open by default')

  const hideFilters = document.querySelector('button[aria-label="Hide filters"]')
  assert.ok(hideFilters, 'expected Filters section header')
  await React.act(async () => {
    hideFilters!.click()
  })
  assert.equal(buttonByLabel('Installed'), undefined)
  assert.equal(document.querySelector('button[aria-label="Show filters"]') != null, true)

  await React.act(async () => {
    root.unmount()
  })
})

test('save appears in the filters header when criteria are active', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let saved = false

  function SaveHarness() {
    const [filters, setFilters] = React.useState<LibraryFilter[]>(['installed'])
    const [filterGroupsOpen, setFilterGroupsOpen] = React.useState(groupsOpen)
    const [filtersPanelOpen, setFiltersPanelOpen] = React.useState(true)
    return React.createElement(LibraryFiltersPanel, {
      libraryFilters: filters,
      libraryFilterCounts: counts,
      onLibraryFiltersChange: setFilters,
      filterGroupsOpen,
      onFilterGroupsOpenChange: setFilterGroupsOpen,
      filtersPanelOpen,
      onFiltersPanelOpenChange: setFiltersPanelOpen,
      hasActiveLibraryCriteria: true,
      onCreateSavedFilter: () => {
        saved = true
      },
    })
  }

  await React.act(async () => {
    root.render(React.createElement(SaveHarness))
  })
  const save = buttonByLabel('Save', { visibleOnly: true })
  assert.ok(save, 'expected Save control in Filters header')
  assert.equal(save!.closest('.group\\/library-filters') != null, true)
  assert.match(save!.textContent ?? '', /Save/)
  await React.act(async () => {
    save!.click()
  })
  assert.equal(saved, true)

  await React.act(async () => {
    root.unmount()
  })
})

test('a collapsed filter group stays collapsed across a tab switch', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(SidebarHarness))
  })
  const hideType = document.querySelector('button[aria-label="Hide type"]')
  assert.ok(hideType, 'expected the Type group to start open')
  assert.ok(buttonByLabel('VF'), 'expected VF while Type is open')

  await React.act(async () => {
    hideType.click()
  })
  assert.equal(document.querySelector('button[aria-label="Show type"]') != null, true)
  assert.equal(buttonByLabel('VF'), undefined)

  const onThisMac = buttonByLabel('On this Mac')
  assert.ok(onThisMac, 'expected the On this Mac tab')
  await React.act(async () => {
    onThisMac.click()
  })
  assert.equal(document.querySelector('button[aria-label="Show type"]'), null)
  assert.equal(document.querySelector('button[aria-label="Hide status"]'), null)

  const fonts = buttonByLabel('Fonts')
  assert.ok(fonts, 'expected the Fonts tab')
  await React.act(async () => {
    fonts.click()
  })
  assert.equal(document.querySelector('button[aria-label="Show type"]') != null, true)
  assert.equal(buttonByLabel('VF'), undefined)
  assert.ok(buttonByLabel('Installed'), 'expected other groups to stay open')

  await React.act(async () => {
    root.unmount()
  })
})

test('filter group headings use capitalize styling', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { initial: [] }))
  })
  const statusHeading = [...document.querySelectorAll('span')].find(
    (span) => span.textContent === 'Status',
  )
  assert.ok(statusHeading, 'expected Status group heading')
  assert.match(statusHeading!.className, /\bcapitalize\b/)
  assert.doesNotMatch(statusHeading!.className, /\buppercase\b/)

  await React.act(async () => {
    root.unmount()
  })
})
})

after(() => {
  dom.close()
})
