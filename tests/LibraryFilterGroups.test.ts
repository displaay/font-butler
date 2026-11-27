// Run via `npm test`, which sets TSX_TSCONFIG_PATH so Sidebar JSX and @/ aliases resolve.
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { Window } from 'happy-dom'
import type { LibraryFilter } from '../src/lib/types.ts'
import { LIBRARY_FILTER_GROUPS_KEY } from '../shared/library-filter-groups.ts'

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
  Event: dom.Event,
  CustomEvent: dom.CustomEvent,
  FocusEvent: dom.FocusEvent,
  KeyboardEvent: dom.KeyboardEvent,
  MouseEvent: dom.MouseEvent,
  DragEvent: dom.DragEvent,
  PointerEvent: dom.PointerEvent,
  NodeFilter: dom.NodeFilter,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
}
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

const keepNodeBuiltins = new Set([
  'AbortController',
  'AbortSignal',
  'Array',
  'ArrayBuffer',
  'Blob',
  'Boolean',
  'BroadcastChannel',
  'Buffer',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'File',
  'Float32Array',
  'Float64Array',
  'FormData',
  'Function',
  'Headers',
  'Infinity',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'MessageChannel',
  'MessagePort',
  'Number',
  'Object',
  'Promise',
  'RangeError',
  'ReadableStream',
  'ReferenceError',
  'RegExp',
  'Request',
  'Response',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TextDecoder',
  'TextEncoder',
  'TransformStream',
  'TypeError',
  'URIError',
  'URL',
  'URLSearchParams',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet',
  'WritableStream',
])
for (const key of new Set([
  ...Object.getOwnPropertyNames(dom),
  ...Object.getOwnPropertyNames(Object.getPrototypeOf(dom)),
])) {
  if (!/^[A-Z]/.test(key) || keepNodeBuiltins.has(key)) continue
  try {
    Object.defineProperty(globalThis, key, {
      value: (dom as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    })
  } catch {
    // Some window accessors are not writable from Node.
  }
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

function isClearFiltersButton(button: Element): boolean {
  const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text === 'Clear' && button.querySelector('svg') != null
}

function clearButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) =>
      isClearFiltersButton(button) && button.getAttribute('aria-hidden') !== 'true',
  ) as HTMLButtonElement | undefined
}

function clearButtonSlot(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) =>
    isClearFiltersButton(button),
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
  assert.ok(clearSlot, 'expected Clear slot in Filters header')
  assert.equal(clearSlot!.getAttribute('aria-hidden'), 'true')
  assert.equal(clearButton(), undefined)
  assert.deepEqual(pressedFilters(), [])

  await React.act(async () => {
    root.render(React.createElement(Harness, { key: 'one', initial: ['installed'] }))
  })
  const one = clearButton()
  assert.ok(one, 'expected Clear when one filter is selected')
  assert.equal(
    one.closest('.group\\/library-filters') != null,
    true,
    'expected Clear in the Filters header row',
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
  assert.ok(many, 'expected Clear when several filters are selected')
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

function groupOrder(): string[] {
  return [...document.querySelectorAll('[data-filter-group]')].map(
    (element) => element.getAttribute('data-filter-group') ?? '',
  )
}

function storedGroupIds(): string[] {
  const raw = localStorage.getItem(LIBRARY_FILTER_GROUPS_KEY)
  if (!raw) return []
  const parsed = JSON.parse(raw) as { id: string; visible: boolean }[]
  return parsed.map((group) => `${group.id}:${group.visible ? 'shown' : 'hidden'}`)
}

function dispatchDrag(target: Element, type: string, clientY = 0) {
  const event = new dom.DragEvent(type, {
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'clientX', { value: 12 })
  Object.defineProperty(event, 'clientY', { value: clientY })
  const store = new Map<string, string>()
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      effectAllowed: 'all',
      dropEffect: 'none',
      types: ['text/plain'],
      setData(kind: string, value: string) {
        store.set(kind, value)
      },
      getData(kind: string) {
        return store.get(kind) ?? ''
      },
    },
  })
  target.dispatchEvent(event)
}

function stubGroupRect(id: string, top: number, height: number) {
  const group = document.querySelector(`[data-filter-group="${id}"]`)
  assert.ok(group, `expected filter group ${id}`)
  Object.defineProperty(group, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        x: 0,
        y: top,
        top,
        left: 0,
        right: 240,
        bottom: top + height,
        width: 240,
        height,
        toJSON() {
          return {}
        },
      }) as DOMRect,
  })
  return group
}

test('dragging a filter heading reorders visible groups and keeps hidden ones', async () => {
  localStorage.setItem(
    LIBRARY_FILTER_GROUPS_KEY,
    JSON.stringify([
      { id: 'status', visible: true },
      { id: 'classification', visible: false },
      { id: 'type', visible: true },
      { id: 'source', visible: true },
      { id: 'destination', visible: true },
      { id: 'format', visible: true },
      { id: 'foundry', visible: false },
    ]),
  )
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { initial: [] }))
  })

  const statusHeading = document.querySelector('button[aria-label="Hide status"]')
  const installed = buttonByLabel('Installed')
  assert.ok(statusHeading, 'expected the Status heading')
  assert.equal(statusHeading.getAttribute('draggable'), 'true')
  assert.match(statusHeading.className, /cursor-grab/)
  assert.match(statusHeading.className, /active:cursor-grabbing/)
  assert.equal(statusHeading.getAttribute('title'), 'Drag to reorder Status')
  assert.equal(installed?.getAttribute('draggable'), null)
  assert.deepEqual(groupOrder(), ['status', 'type', 'source', 'destination', 'format'])

  await React.act(async () => {
    installed!.click()
  })
  assert.deepEqual(pressedFilters(), ['Filter installed'])
  assert.deepEqual(groupOrder(), ['status', 'type', 'source', 'destination', 'format'])

  await React.act(async () => {
    statusHeading.click()
  })
  assert.equal(document.querySelector('button[aria-label="Show status"]') != null, true)
  assert.equal(buttonByLabel('Installed'), undefined)
  const showStatus = document.querySelector('button[aria-label="Show status"]')
  assert.ok(showStatus, 'expected Status to collapse')
  await React.act(async () => {
    showStatus.click()
  })
  assert.ok(buttonByLabel('Installed'), 'expected Status to expand again without reordering')

  const formatHeading = document.querySelector('button[aria-label="Hide format"]')
  assert.ok(formatHeading, 'expected the Format heading')

  await React.act(async () => {
    dispatchDrag(formatHeading, 'dragstart')
  })
  assert.equal(document.querySelector('[data-filter-group="format"]')?.getAttribute('data-dragging'), 'true')
  assert.match(document.querySelector('[data-filter-group="format"]')?.className ?? '', /opacity-60/)
  const statusGroup = stubGroupRect('status', 0, 100)

  await React.act(async () => {
    dispatchDrag(statusGroup, 'dragover', 20)
  })
  assert.equal(statusGroup.getAttribute('data-drop-line'), 'before')
  assert.equal(statusGroup.querySelector('span[aria-hidden]')?.className.includes('top-0'), true)

  const statusGroupLower = stubGroupRect('status', 0, 100)
  await React.act(async () => {
    dispatchDrag(statusGroupLower, 'dragover', 80)
  })
  assert.equal(statusGroupLower.getAttribute('data-drop-line'), 'after')
  assert.equal(statusGroupLower.querySelector('span[aria-hidden]')?.className.includes('bottom-0'), true)

  const statusGroupDrop = stubGroupRect('status', 0, 100)
  await React.act(async () => {
    dispatchDrag(statusGroupDrop, 'drop', 20)
    dispatchDrag(formatHeading, 'dragend')
  })
  assert.deepEqual(groupOrder(), ['format', 'status', 'type', 'source', 'destination'])
  assert.equal(document.querySelector('[data-dragging="true"]'), null)
  assert.equal(document.querySelector('[data-drop-line]'), null)
  assert.deepEqual(storedGroupIds(), [
    'format:shown',
    'classification:hidden',
    'status:shown',
    'type:shown',
    'source:shown',
    'destination:shown',
    'foundry:hidden',
  ])
  assert.deepEqual(pressedFilters(), ['Filter installed'])

  await React.act(async () => {
    buttonByLabel('Edit filters')!.click()
  })
  const dialogLabels = [...document.querySelectorAll('li span')]
    .map((span) => (span.textContent ?? '').trim())
    .filter(Boolean)
  assert.deepEqual(dialogLabels, [
    'Format',
    'Classification',
    'Status',
    'Type',
    'Source',
    'Destination',
    'Foundries',
  ])

  await React.act(async () => {
    root.unmount()
  })
  localStorage.removeItem(LIBRARY_FILTER_GROUPS_KEY)
})

test('a click, a self-drop, Escape, and a drop outside do not reorder filter groups', async () => {
  localStorage.removeItem(LIBRARY_FILTER_GROUPS_KEY)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { initial: [] }))
  })
  const initial = groupOrder()
  const statusHeading = document.querySelector('button[aria-label="Hide status"]')
  const typeHeading = document.querySelector('button[aria-label="Hide type"]')
  assert.ok(statusHeading && typeHeading)
  const statusGroup = stubGroupRect('status', 0, 100)

  await React.act(async () => {
    statusHeading.click()
  })
  assert.equal(localStorage.getItem(LIBRARY_FILTER_GROUPS_KEY), null)
  await React.act(async () => {
    document.querySelector('button[aria-label="Show status"]')!.click()
  })

  await React.act(async () => {
    dispatchDrag(statusHeading, 'dragstart')
    dispatchDrag(statusGroup, 'drop', 10)
    dispatchDrag(statusHeading, 'dragend')
  })
  assert.deepEqual(groupOrder(), initial)
  assert.equal(localStorage.getItem(LIBRARY_FILTER_GROUPS_KEY), null)

  await React.act(async () => {
    dispatchDrag(statusHeading, 'dragstart')
  })
  await React.act(async () => {
    window.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(document.querySelector('[data-dragging="true"]'), null)
  await React.act(async () => {
    dispatchDrag(stubGroupRect('type', 120, 80), 'drop', 10)
    dispatchDrag(statusHeading, 'dragend')
  })
  assert.deepEqual(groupOrder(), initial)

  await React.act(async () => {
    dispatchDrag(typeHeading, 'dragstart')
    dispatchDrag(typeHeading, 'dragend')
  })
  assert.deepEqual(groupOrder(), initial)
  assert.equal(localStorage.getItem(LIBRARY_FILTER_GROUPS_KEY), null)

  await React.act(async () => {
    root.unmount()
  })
})

test('Alt+Arrow moves a filter group and stays in sync with Edit filters', async () => {
  localStorage.removeItem(LIBRARY_FILTER_GROUPS_KEY)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { initial: [] }))
  })
  const statusHeading = document.querySelector('button[aria-label="Hide status"]')
  assert.ok(statusHeading)
  assert.equal(statusHeading.getAttribute('aria-keyshortcuts'), 'Alt+ArrowUp Alt+ArrowDown')

  await React.act(async () => {
    statusHeading.dispatchEvent(
      new dom.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }),
    )
  })
  assert.deepEqual(groupOrder(), ['type', 'status', 'source', 'destination', 'format'])
  assert.deepEqual(storedGroupIds(), [
    'type:shown',
    'status:shown',
    'source:shown',
    'destination:shown',
    'format:shown',
    'classification:hidden',
    'foundry:hidden',
  ])

  await React.act(async () => {
    statusHeading.dispatchEvent(
      new dom.KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }),
    )
  })
  assert.deepEqual(groupOrder(), ['status', 'type', 'source', 'destination', 'format'])

  await React.act(async () => {
    root.unmount()
  })
  localStorage.removeItem(LIBRARY_FILTER_GROUPS_KEY)
})

test('classification stays hidden until Edit filters turns that group on', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await React.act(async () => {
    root.render(React.createElement(Harness, { initial: [] }))
  })
  assert.equal(buttonByLabel('Serif'), undefined)
  assert.equal(buttonByLabel('Foundries') ?? buttonByLabel('Displaay'), undefined)
  assert.ok(buttonByLabel('Edit filters'), 'expected Edit filters under the filter groups')
  assert.ok(buttonByLabel('Installed'), 'expected the default groups to stay visible')

  await React.act(async () => {
    root.unmount()
  })
})
})

after(() => {
  dom.close()
})
