import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import type { CatalogEntry, FamilyGroup, FontFaceInfo } from '../lib/types.ts'

const dom = new Window({
  url: 'http://127.0.0.1:43181/',
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
})

const view = dom as unknown as Window & typeof globalThis
globalThis.window = view
globalThis.document = view.document
globalThis.HTMLElement = view.HTMLElement
globalThis.Element = view.Element
globalThis.Node = view.Node
globalThis.DocumentFragment = view.DocumentFragment
globalThis.SVGElement = view.SVGElement
globalThis.getComputedStyle = view.getComputedStyle.bind(view)
globalThis.requestAnimationFrame = view.requestAnimationFrame.bind(view)
globalThis.cancelAnimationFrame = view.cancelAnimationFrame.bind(view)
globalThis.MutationObserver = view.MutationObserver
globalThis.ResizeObserver = view.ResizeObserver
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: {
    check: () => false,
    load: () => new Promise(() => {}),
    ready: Promise.resolve(),
    addEventListener() {},
    removeEventListener() {},
    forEach() {},
  },
})

function fontFace(): FontFaceInfo {
  return {
    familyName: 'New Azeret',
    styleName: 'Regular',
    fullName: 'New Azeret Regular',
    postscriptName: 'NewAzeret-Regular',
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function catalogEntry(warning?: string): CatalogEntry {
  return {
    id: 'new-azeret',
    sourcePath: '/tmp/NewAzeret.ttf',
    sourceMtimeMs: 1,
    sourceSize: 8,
    status: 'installed',
    faces: [fontFace()],
    format: 'ttf',
    previewSample: 'Aa',
    activationWarning: warning,
    addedAt: 1,
    updatedAt: 1,
  }
}

function familyGroup(entry: CatalogEntry): FamilyGroup {
  return {
    key: entry.id,
    familyName: 'New Azeret',
    entries: [entry],
    faces: entry.faces,
    isVariable: false,
    instanceCount: 1,
    status: 'installed',
    previewEntryId: entry.id,
    addedAt: 1,
  }
}

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { LibraryCard } = await import('./LibraryCard.tsx')
const { TooltipProvider } = await import('./ui/tooltip.tsx')

const warning =
  'Both copies of NewAzeret-Regular are installed. The other file is /Users/me/Library/Fonts/NewAzeret-Regular.ttf.'

function libraryProps(group: FamilyGroup, layout: 'grid' | 'list') {
  const noop = () => {}
  return {
    group,
    layout,
    previewSize: 2.5,
    selected: false,
    selectedEntryId: null,
    busy: false,
    batch: null,
    onSelect: noop,
    onInspect: noop,
    onSelectEntry: noop,
    onEnsureSelected: noop,
    onInstall: noop,
    onInstallAs: noop,
    onInstallToAdobe: noop,
    onInstallInstance: noop,
    onActivateInstance: noop,
    onDeactivateInstance: noop,
    onUninstallInstance: noop,
    onInstallInstanceToAdobe: noop,
    onReinstall: noop,
    onUninstall: noop,
    onUninstallFormat: noop,
    onUninstallAndRemove: noop,
    onDeactivate: noop,
    onActivate: noop,
    onReveal: noop,
    onRevealSource: noop,
    onForget: noop,
    onDeleteFiles: noop,
    projects: [],
    projectFilter: null,
    dragIds: [],
    projectFamilyNames: [],
    onAddToProject: noop,
    onRemoveFromProject: noop,
    onCreateProjectFromCard: noop,
    onFontDragStart: noop,
    onFontDragEnd: noop,
  }
}

async function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(TooltipProvider, null, node))
  })
  return {
    host,
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

function badge(host: ParentNode): HTMLElement | undefined {
  return [...host.querySelectorAll('span')].find((node) => node.textContent === 'Two copies')
}

test('the library card keeps a duplicate-copy badge in list and grid', async () => {
  const group = familyGroup(catalogEntry(warning))
  const { host, unmount } = await mount(
    createElement(
      'div',
      null,
      createElement(LibraryCard, libraryProps(group, 'list')),
      createElement(LibraryCard, libraryProps(group, 'grid')),
    ),
  )
  try {
    const badges = [...host.querySelectorAll('span')].filter((node) => node.textContent === 'Two copies')
    assert.equal(badges.length, 2)
    for (const node of badges) {
      assert.equal(node.getAttribute('title'), warning)
      assert.equal((node.getAttribute('title') ?? '').includes('served'), false)
      assert.match(node.getAttribute('title') ?? '', /NewAzeret-Regular\.ttf/)
    }
  } finally {
    await unmount()
  }
})

test('a deactivated card does not keep a stale two-copies badge', async () => {
  const entry = catalogEntry(warning)
  entry.status = 'deactivated'
  const { host, unmount } = await mount(
    createElement(LibraryCard, libraryProps(familyGroup(entry), 'list')),
  )
  try {
    assert.equal(badge(host), undefined)
  } finally {
    await unmount()
  }
})

test('a card without a duplicate warning has no two-copies badge', async () => {
  const { host, unmount } = await mount(
    createElement(LibraryCard, libraryProps(familyGroup(catalogEntry()), 'list')),
  )
  try {
    assert.equal(badge(host), undefined)
  } finally {
    await unmount()
  }
})
