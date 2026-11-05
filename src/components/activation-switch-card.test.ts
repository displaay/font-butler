import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { groupCatalog } from '../lib/group.ts'
import type { CatalogEntry, FontFaceInfo, SystemFace, SystemFamilyGroup } from '../lib/types.ts'

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
globalThis.HTMLButtonElement = view.HTMLButtonElement
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('./ui/tooltip.tsx')
const { LibraryCard } = await import('./LibraryCard.tsx')
const { SystemCard } = await import('./SystemCard.tsx')

function face(familyName: string, styleName = 'Regular'): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(id: string, status: CatalogEntry['status']): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1000,
    status,
    faces: [face('Inter')],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
  }
}

function systemFace(overrides: Partial<SystemFace> = {}): SystemFace {
  return {
    path: '/Library/Fonts/Inter-Regular.otf',
    familyName: 'Inter',
    styleName: 'Regular',
    fullName: 'Inter Regular',
    postscriptName: 'Inter-Regular',
    isVariable: false,
    instanceCount: 1,
    weight: 400,
    italic: false,
    format: 'otf',
    protected: false,
    writable: true,
    ...overrides,
  }
}

function systemGroup(faces: SystemFace[], writable = true): SystemFamilyGroup {
  return {
    key: 'Inter',
    familyName: 'Inter',
    faces,
    isVariable: false,
    instanceCount: faces.length,
    protected: false,
    writable,
  }
}

function marqueeBlocker(node: Element | null): Element | null {
  let current = node
  for (let depth = 0; depth < 40 && current; depth += 1) {
    if (current.hasAttribute('data-no-marquee')) return current
    current = current.parentElement
  }
  return null
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

function libraryProps(
  status: CatalogEntry['status'],
  calls: { selection: string[]; family: string[] },
) {
  const noop = () => {}
  const group = groupCatalog([entry('inter', status)])[0]!
  return {
    group,
    layout: 'grid' as const,
    previewSize: 2.5,
    selected: true,
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
    onDeactivate: () => {
      calls.selection.push('deactivate')
    },
    onActivate: () => {
      calls.selection.push('activate')
    },
    onActivateFamily: () => {
      calls.family.push('activate')
    },
    onDeactivateFamily: () => {
      calls.family.push('deactivate')
    },
    onActivateUntilQuit: noop,
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

test('the card switch toggles one family and leaves the preview free for marquee', async () => {
  const calls = { selection: [] as string[], family: [] as string[] }
  const { host, unmount } = await mount(createElement(LibraryCard, libraryProps('deactivated', calls)))
  const card = host.querySelector('[data-family-key="Inter"]')
  const preview = card?.querySelector('button.flex.w-full')
  const toggle = host.querySelector('[data-activation-switch]') as HTMLButtonElement
  assert.ok(preview)
  assert.equal(marqueeBlocker(preview ?? null), null)
  assert.equal(marqueeBlocker(toggle), toggle)
  assert.equal(card?.querySelector('[data-undimmed]')?.hasAttribute('data-no-marquee'), false)
  assert.equal(toggle.getAttribute('data-position'), 'off')
  assert.equal(toggle.disabled, false)
  assert.equal(toggle.className.includes('outline-none'), false)
  toggle.click()
  assert.deepEqual(calls.family, ['activate'])
  assert.deepEqual(calls.selection, [])
  await unmount()
})

test('an active family switch deactivates only that family', async () => {
  const calls = { selection: [] as string[], family: [] as string[] }
  const { host, unmount } = await mount(createElement(LibraryCard, libraryProps('installed', calls)))
  const toggle = host.querySelector('[data-activation-switch]') as HTMLButtonElement
  assert.equal(toggle.getAttribute('data-position'), 'on')
  toggle.click()
  assert.deepEqual(calls.family, ['deactivate'])
  assert.deepEqual(calls.selection, [])
  await unmount()
})

test('a parked Mac family switch turns that family back on', async () => {
  let family = ''
  let selection = ''
  const { host, unmount } = await mount(
    createElement(SystemCard, {
      group: systemGroup([systemFace({ deactivated: true, managedId: 'parked', path: '/tmp/disabled/Inter.otf' })]),
      layout: 'list',
      previewSize: 2.5,
      selected: true,
      busy: false,
      batch: null,
      onSelect: () => {},
      onInspect: () => {},
      onReveal: () => {},
      onUninstall: () => {},
      onDeactivate: () => {
        selection = 'selection'
      },
      onActivateFamily: () => {
        family = 'activate'
      },
      onDeactivateFamily: () => {
        family = 'deactivate'
      },
    }),
  )
  const card = host.querySelector('[data-family-key="Inter"]')
  const preview = card?.querySelector('button.flex')
  const toggle = host.querySelector('[data-activation-switch]') as HTMLButtonElement
  assert.ok(preview)
  assert.equal(marqueeBlocker(preview ?? null), null)
  assert.equal(marqueeBlocker(toggle), toggle)
  assert.equal(toggle.getAttribute('data-position'), 'off')
  assert.equal(toggle.disabled, false)
  assert.equal(toggle.getAttribute('title'), 'Activate')
  toggle.click()
  assert.equal(family, 'activate')
  assert.equal(selection, '')
  await unmount()
})
