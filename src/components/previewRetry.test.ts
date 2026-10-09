import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { PREVIEW_LOAD_TIMEOUT_MS, setPreviewLoadTimeoutForTests } from '../lib/previewReady.ts'
import type {
  CatalogEntry,
  FamilyGroup,
  FontFaceInfo,
  SystemFace,
  SystemFamilyGroup,
} from '../lib/types.ts'
import type { InstanceRow } from '../lib/instances.ts'

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

let loads = 0

function installHungFonts(families: string[]) {
  loads = 0
  const fonts = {
    check: () => false,
    load: () => {
      loads += 1
      return new Promise(() => {})
    },
    ready: Promise.resolve(),
    addEventListener() {},
    removeEventListener() {},
    forEach(callback: (face: { family: string; weight: number; style: string; status: string }) => void) {
      for (const family of families) {
        for (const weight of [400, 700]) {
          callback({ family, weight, style: 'normal', status: 'loading' })
        }
      }
    },
  }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
}

function fontFace(styleName: string, weight: number): FontFaceInfo {
  return {
    familyName: 'Retry Family',
    styleName,
    fullName: `Retry Family ${styleName}`,
    postscriptName: `Retry-${styleName}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight,
    italic: false,
  }
}

function catalogEntry(id: string, faces: FontFaceInfo[]): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 8,
    status: 'installed',
    faces,
    format: 'otf',
    previewSample: 'Hamburgefonstiv',
    addedAt: 1,
    updatedAt: 1,
  }
}

function familyGroup(entry: CatalogEntry): FamilyGroup {
  return {
    key: entry.id,
    familyName: 'Retry Family',
    entries: [entry],
    faces: entry.faces,
    isVariable: false,
    instanceCount: entry.faces.length,
    status: 'installed',
    previewEntryId: entry.id,
    addedAt: 1,
  }
}

function systemFace(path: string, styleName: string, weight: number): SystemFace {
  return {
    path,
    familyName: 'System Retry',
    styleName,
    fullName: `System Retry ${styleName}`,
    postscriptName: `SystemRetry-${styleName}`,
    isVariable: false,
    instanceCount: 1,
    weight,
    italic: false,
    format: 'otf',
    previewSample: 'Hamburgefonstiv',
    protected: false,
    writable: true,
  }
}

function systemGroup(faces: SystemFace[]): SystemFamilyGroup {
  return {
    key: 'system-retry',
    familyName: 'System Retry',
    faces,
    isVariable: false,
    instanceCount: faces.length,
    protected: false,
    writable: true,
  }
}

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { LibraryCard } = await import('./LibraryCard.tsx')
const { SystemCard } = await import('./SystemCard.tsx')
const { InstanceList } = await import('./InstanceList.tsx')
const { catalogFontFamily, systemFontFamily } = await import('./FontFaceStyles.tsx')
const { TooltipProvider } = await import('./ui/tooltip.tsx')

function assertNoNestedButtons(root: ParentNode) {
  for (const button of root.querySelectorAll('button')) {
    assert.equal(
      button.parentElement?.closest('button'),
      null,
      `nested button: ${(button.textContent ?? '').trim()}`,
    )
  }
}

function assertRetryIsOutsideCards(root: ParentNode) {
  const retries = [...root.querySelectorAll('[data-preview-retry]')]
  assert.equal(retries.length, 1, 'one focusable Retry')
  const retry = retries[0] as HTMLButtonElement
  assert.equal(retry.tagName, 'BUTTON')
  assert.equal(retry.closest('[aria-hidden="true"]'), null)
  assert.equal(root.querySelector('button [data-preview-retry]'), null)
  assert.equal(root.querySelector('button button'), null)
  const card = [...root.querySelectorAll('button')].find(
    (button) => button !== retry && (button.textContent ?? '').includes('Retry'),
  )
  assert.ok(card, 'card button is present')
  const order = card.compareDocumentPosition(retry)
  assert.ok(order & Node.DOCUMENT_POSITION_FOLLOWING, 'Tab reaches the card, then Retry')
  return retry
}

function assertNoRetryInHiddenLayers(root: ParentNode) {
  const hiddenLayers = [...root.querySelectorAll('[aria-hidden="true"]')].filter((el) =>
    String(el.className).includes('opacity-0'),
  )
  assert.ok(hiddenLayers.length > 0, 'a cycling layer is aria-hidden')
  for (const layer of hiddenLayers) {
    assert.equal(layer.querySelector('button, [data-preview-retry]'), null)
    assert.equal((layer.textContent ?? '').includes('Retry'), false)
  }
  for (const hidden of root.querySelectorAll('[aria-hidden="true"]')) {
    if (hidden.hasAttribute('data-preview-retry-spacer')) continue
    assert.equal(hidden.querySelector('button, [data-preview-retry]'), null)
    assert.equal((hidden.textContent ?? '').includes('Retry'), false)
  }
}

async function waitUntilFailed() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80))
  })
}

async function activateRetry(retry: HTMLButtonElement, kind: 'Enter' | ' ' | 'click') {
  await act(async () => {
    if (kind === 'click') {
      retry.click()
      return
    }
    retry.dispatchEvent(
      new view.KeyboardEvent('keydown', { key: kind, bubbles: true, cancelable: true }),
    )
  })
}

function libraryProps(group: FamilyGroup, layout: 'grid' | 'list', onSelect: () => void) {
  const noop = () => {}
  return {
    group,
    layout,
    previewSize: 2.5,
    selected: false,
    selectedEntryId: null,
    busy: false,
    batch: null,
    onSelect,
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

test('failed library, system, and instance cards keep Retry outside the card button', async () => {
  setPreviewLoadTimeoutForTests(20)
  const entry = catalogEntry('retry-cards', [fontFace('Regular', 400), fontFace('Bold', 700)])
  const group = familyGroup(entry)
  const sysA = '/tmp/system-retry-regular.otf'
  const sysB = '/tmp/system-retry-bold.otf'
  const system = systemGroup([systemFace(sysA, 'Regular', 400), systemFace(sysB, 'Bold', 700)])
  installHungFonts([
    catalogFontFamily(entry.id),
    systemFontFamily(sysA),
    systemFontFamily(sysB),
  ])

  let selects = 0
  const { host, unmount } = await mount(
    createElement('div', null,
      createElement(LibraryCard, libraryProps(group, 'grid', () => { selects += 1 })),
      createElement(LibraryCard, libraryProps(group, 'list', () => { selects += 1 })),
      createElement(SystemCard, {
        group: system,
        layout: 'grid',
        previewSize: 2.5,
        selected: false,
        busy: false,
        batch: null,
        onSelect: () => { selects += 1 },
        onInspect: () => {},
        onReveal: () => {},
        onUninstall: () => {},
        onDeactivate: () => {},
      }),
      createElement(SystemCard, {
        group: system,
        layout: 'list',
        previewSize: 2.5,
        selected: false,
        busy: false,
        batch: null,
        onSelect: () => { selects += 1 },
        onInspect: () => {},
        onReveal: () => {},
        onUninstall: () => {},
        onDeactivate: () => {},
      }),
      createElement(InstanceList, {
        rows: [
          {
            key: 'retry-instance',
            label: 'Regular',
            catalogEntryId: entry.id,
            weight: 400,
            italic: false,
            previewSample: 'Hamburgefonstiv',
            installState: 'installed',
          } satisfies InstanceRow,
        ],
        selectedEntryId: null,
        onSelectEntry: () => { selects += 1 },
        instanceActions: {
          entries: [entry],
          busy: false,
          onInstall: () => {},
          onActivate: () => {},
          onDeactivate: () => {},
          onUninstall: () => {},
          onInstallToAdobe: () => {},
        },
      }),
    ),
  )

  try {
    const cards = [...host.querySelectorAll('[data-family-key]')]
    assert.equal(cards.length, 4)
    for (const card of cards) {
      await act(async () => {
        card.dispatchEvent(new view.PointerEvent('pointerover', { bubbles: true }))
      })
    }
    await waitUntilFailed()

    assertNoNestedButtons(host)
    const retries = [...host.querySelectorAll('[data-preview-retry]')]
    assert.equal(retries.length, 5, 'library grid, library list, system grid, system list, instance')
    for (const retry of retries) {
      assert.equal(retry.closest('button'), retry)
      assert.equal(retry.closest('[aria-hidden="true"]'), null)
      const card = retry.parentElement?.querySelector(':scope > button:not([data-preview-retry])')
        ?? [...(retry.parentElement?.querySelectorAll('button') ?? [])].find((button) => button !== retry)
      assert.ok(card)
      assert.equal(card.contains(retry), false)
      assert.ok(card.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING)
    }
    assert.equal(host.querySelector('button button'), null)
    assert.equal(host.querySelector('button [data-preview-retry]'), null)

    const hiddenLayers = [...host.querySelectorAll('[aria-hidden="true"]')].filter((el) =>
      String(el.className).includes('opacity-0'),
    )
    assert.ok(hiddenLayers.length >= 2, 'grid cards paint an aria-hidden cycling layer')
    assertNoRetryInHiddenLayers(host)
    assert.equal(host.textContent?.includes('Hamburgefonstiv'), false)

    const before = loads
    const retry = retries[0] as HTMLButtonElement
    await activateRetry(retry, 'Enter')
    assert.equal(selects, 0)
    assert.ok(loads > before)
    await waitUntilFailed()

    const afterEnter = [...host.querySelectorAll('[data-preview-retry]')]
    const spaceTarget = afterEnter[0] as HTMLButtonElement
    assert.ok(spaceTarget)
    const beforeSpace = loads
    await activateRetry(spaceTarget, ' ')
    assert.equal(selects, 0)
    assert.ok(loads > beforeSpace)
    await waitUntilFailed()

    const clickTarget = host.querySelector('[data-preview-retry]') as HTMLButtonElement
    assert.ok(clickTarget)
    const beforeClick = loads
    await activateRetry(clickTarget, 'click')
    assert.equal(selects, 0)
    assert.ok(loads > beforeClick)

    const cardButton = [...host.querySelectorAll('button')].find(
      (button) => !button.hasAttribute('data-preview-retry') && (button.textContent ?? '').includes('Retry Family'),
    )
    assert.ok(cardButton)
    await act(async () => {
      cardButton.click()
    })
    assert.equal(selects, 1)
  } finally {
    await unmount()
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
  }
})

test('each failed card button is followed by its own Retry', async () => {
  setPreviewLoadTimeoutForTests(20)
  const entry = catalogEntry('retry-order', [fontFace('Regular', 400)])
  installHungFonts([catalogFontFamily(entry.id)])
  const { host, unmount } = await mount(
    createElement(LibraryCard, libraryProps(familyGroup(entry), 'list', () => {})),
  )
  try {
    await waitUntilFailed()
    assertNoNestedButtons(host)
    assertRetryIsOutsideCards(host)
    for (const hidden of host.querySelectorAll('[aria-hidden="true"]')) {
      if (hidden.hasAttribute('data-preview-retry-spacer')) continue
      assert.equal((hidden.textContent ?? '').includes('Retry'), false)
      assert.equal(hidden.querySelector('button'), null)
    }
  } finally {
    await unmount()
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
  }
})
