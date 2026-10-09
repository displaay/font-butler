import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import {
  PREVIEW_LOAD_TIMEOUT_MS,
  retryPreviewFamily,
  setPreviewLoadTimeoutForTests,
} from '../lib/previewReady.ts'
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
const { FontFaceStyles, catalogFontFamily, systemFontFamily } = await import('./FontFaceStyles.tsx')
const { setPreviewCssWriteGateForTests, setPreviewFaceRefreshForTests } = await import(
  './fontFaceTestHooks.ts'
)
const { usePreviewFontStatus } = await import('../hooks/usePreviewFontReady.ts')
const { verifyFontPreviewQuery } = await import('../../core/font-access.ts')
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

function siblingCardButton(retry: HTMLElement): HTMLButtonElement {
  const card = retry.parentElement?.querySelector(':scope > button:not([data-preview-retry])')
  assert.equal(card?.tagName, 'BUTTON')
  return card as HTMLButtonElement
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
  const gridEntry = catalogEntry('retry-lib-grid', [fontFace('Regular', 400), fontFace('Bold', 700)])
  const listEntry = catalogEntry('retry-lib-list', [fontFace('Regular', 400), fontFace('Bold', 700)])
  const instanceEntry = catalogEntry('retry-instance', [fontFace('Regular', 400)])
  const sysA = '/tmp/system-retry-regular.otf'
  const sysB = '/tmp/system-retry-bold.otf'
  const system = systemGroup([systemFace(sysA, 'Regular', 400), systemFace(sysB, 'Bold', 700)])
  installHungFonts([
    catalogFontFamily(gridEntry.id),
    catalogFontFamily(listEntry.id),
    catalogFontFamily(instanceEntry.id),
    systemFontFamily(sysA),
    systemFontFamily(sysB),
  ])

  let selects = 0
  let drags = 0
  const gridProps = libraryProps(familyGroup(gridEntry), 'grid', () => { selects += 1 })
  gridProps.onFontDragStart = () => { drags += 1 }
  const { host, unmount } = await mount(
    createElement('div', null,
      createElement(LibraryCard, gridProps),
      createElement(LibraryCard, libraryProps(familyGroup(listEntry), 'list', () => { selects += 1 })),
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
            catalogEntryId: instanceEntry.id,
            weight: 400,
            italic: false,
            previewSample: 'Hamburgefonstiv',
            installState: 'installed',
          } satisfies InstanceRow,
        ],
        selectedEntryId: null,
        onSelectEntry: () => { selects += 1 },
        instanceActions: {
          entries: [instanceEntry],
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

    const libraryRetry = retries[0] as HTMLButtonElement
    assert.equal(libraryRetry.getAttribute('draggable'), 'true')
    await act(async () => {
      libraryRetry.dispatchEvent(new view.DragEvent('dragstart', { bubbles: true, cancelable: true }))
    })
    assert.equal(drags, 0, 'dragstart on Retry does not reach startFontDrag')

    const cardBody = cards[0]?.querySelector('button:not([data-preview-retry])')
    assert.ok(cardBody)
    assert.equal(cardBody.getAttribute('draggable'), null)
    await act(async () => {
      const drag = new view.DragEvent('dragstart', { bubbles: true, cancelable: true })
      Object.defineProperty(drag, 'dataTransfer', {
        value: { setData() {}, effectAllowed: 'copy' },
      })
      cardBody.dispatchEvent(drag)
    })
    assert.equal(drags, 1, 'a drag from the card body starts one font drag')

    const kinds = ['Enter', ' ', 'click', 'Enter', ' '] as const
    assert.equal(retries.length, kinds.length)
    for (const [index, retry] of retries.entries()) {
      const button = retry as HTMLButtonElement
      const card = siblingCardButton(button)
      const kind = kinds[index] ?? 'Enter'
      let outside: HTMLInputElement | null = null
      if (kind === 'click') {
        outside = document.createElement('input')
        document.body.appendChild(outside)
        outside.focus()
        assert.equal(document.activeElement, outside)
      } else {
        await act(async () => {
          button.focus()
        })
        assert.equal(document.activeElement, button)
      }
      const before = loads
      await activateRetry(button, kind)
      assert.equal(selects, 0)
      assert.ok(loads > before, `Retry ${index} (${kind}) retries the preview`)
      assert.equal(button.isConnected, false)
      if (kind === 'click' && outside) {
        assert.equal(
          document.activeElement,
          outside,
          'an unfocused Retry unmount leaves focus on the outside input',
        )
        outside.remove()
      } else {
        assert.equal(document.activeElement, card)
      }
    }

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

type CssFace = { family: string; weight: string; style: string; status: string; url: string }

function installFailOnceFonts() {
  const statusByUrl = new Map<string, string>()
  const requested: string[] = []

  function ruleTexts(style: Element): string[] {
    const sheet = (style as HTMLStyleElement).sheet
    if (sheet && sheet.cssRules.length > 0) {
      const texts: string[] = []
      for (let index = 0; index < sheet.cssRules.length; index += 1) {
        const rule = sheet.cssRules[index]
        if (rule) texts.push(rule.cssText)
      }
      return texts
    }
    return (style.textContent ?? '').split('\n')
  }

  function facesFromCss(): CssFace[] {
    const faces: CssFace[] = []
    for (const style of document.querySelectorAll('style[data-font-butler-face], style[data-font-butler-system]')) {
      for (const rule of ruleTexts(style)) {
        const family = rule.match(/font-family:\s*["']?([^;"'}]+)/)?.[1]?.replace(/["']/g, '').trim()
        const url = rule.match(/url\(\s*["']?([^"')]+)/)?.[1]
        if (!family || !url) continue
        faces.push({
          family,
          weight: rule.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() ?? '400',
          style: rule.match(/font-style:\s*([^;}]+)/)?.[1]?.trim() ?? 'normal',
          status: statusByUrl.get(url) ?? 'unloaded',
          url,
        })
      }
    }
    return faces
  }

  function faceForSpec(spec: string): CssFace | undefined {
    const family = spec.match(/"([^"]+)"/)?.[1] ?? ''
    return facesFromCss().find((face) => face.family === family)
  }

  const fonts = {
    check: (spec: string) => faceForSpec(spec)?.status === 'loaded',
    load: (spec: string) => {
      const face = faceForSpec(spec)
      if (!face) return Promise.resolve([])
      const status = statusByUrl.get(face.url) ?? 'unloaded'
      if (status === 'unloaded') {
        requested.push(face.url)
        statusByUrl.set(face.url, /[?&]r=\d+/.test(face.url) ? 'loaded' : 'error')
      }
      const next = statusByUrl.get(face.url)
      if (next === 'error') return Promise.reject(new Error('NetworkError'))
      return Promise.resolve([face])
    },
    ready: Promise.resolve(),
    addEventListener() {},
    removeEventListener() {},
    forEach(callback: (face: CssFace) => void) {
      for (const face of facesFromCss()) callback(face)
    },
  }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  return requested
}

function FetchProbe({ family }: { family: string }) {
  const status = usePreviewFontStatus(family)
  const state = status.failed ? 'failed' : status.ready ? 'ready' : 'loading'
  return createElement(
    'div',
    null,
    createElement('span', { 'data-state': state }),
    status.failed
      ? createElement(
          'button',
          { type: 'button', 'data-fetch-retry': '', onClick: () => status.retry() },
          'Retry',
        )
      : null,
  )
}

function ruleUrlFromStyle(style: Element, family: string): string {
  const sheet = (style as HTMLStyleElement).sheet
  const rules: string[] = []
  if (sheet && sheet.cssRules.length > 0) {
    for (let index = 0; index < sheet.cssRules.length; index += 1) {
      const rule = sheet.cssRules[index]
      if (rule) rules.push(rule.cssText)
    }
  } else {
    rules.push(...(style.textContent ?? '').split('\n'))
  }
  const match = rules.find((rule) => {
    const name = rule.match(/font-family:\s*["']?([^;"'}]+)/)?.[1]?.replace(/["']/g, '').trim()
    return name === family
  })
  assert.ok(match, family)
  const url = match.match(/url\(\s*["']?([^"')]+)/)?.[1]
  assert.ok(url, family)
  return url
}

async function waitForState(host: ParentNode, state: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (host.querySelector('[data-state]')?.getAttribute('data-state') === state) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
    })
  }
  assert.equal(host.querySelector('[data-state]')?.getAttribute('data-state'), state)
}

test('a failed font-file fetch succeeds when Retry busts the @font-face URL', async () => {
  const secret = 'retry-fetch-secret'
  ;(window as unknown as { fontButlerDesktop?: { getApiToken: () => Promise<string> } }).fontButlerDesktop = {
    getApiToken: async () => secret,
  }
  const entry = catalogEntry('retry-fetch', [fontFace('Regular', 400)])
  const family = catalogFontFamily(entry.id)
  const requested = installFailOnceFonts()
  const { host, unmount } = await mount(
    createElement(
      'div',
      null,
      createElement(FontFaceStyles, { entries: [entry], catalog: [entry], systemFaces: [] }),
      createElement(FetchProbe, { family }),
    ),
  )
  try {
    await waitForState(host, 'failed')
    assert.equal(requested.length, 1, 'the first fetch is the only request while the face is in error')
    assert.equal(/[?&]r=\d+/.test(requested[0] ?? ''), false)
    const style = document.querySelector('style[data-font-butler-face]')
    assert.ok(style?.textContent)
    const failedUrl = ruleUrlFromStyle(style, family)
    assert.equal(failedUrl.includes('r='), false)
    const textBeforeRetry = style.textContent

    const retry = host.querySelector('[data-fetch-retry]')
    assert.equal(retry?.tagName, 'BUTTON')
    await act(async () => {
      ;(retry as HTMLButtonElement).click()
    })
    await waitForState(host, 'ready')

    assert.equal(requested.length, 2, 'Retry issues a second fetch')
    assert.match(requested[1] ?? '', /[?&]r=1(?:&|$)/)
    assert.equal(style.textContent, textBeforeRetry, 'Retry replaces the matching face rule without rewriting the stylesheet text')
    const busted = ruleUrlFromStyle(style, family)
    assert.match(busted, /[?&]r=1(?:&|$)/)
    const installed = ruleUrlFromStyle(style, catalogFontFamily(entry.id, 'installed'))
    assert.equal(/[?&]r=\d+/.test(installed), false, 'only the retried family is busted')
    const parsed = new URL(busted, 'http://127.0.0.1')
    assert.equal(
      verifyFontPreviewQuery(secret, parsed.pathname, Object.fromEntries(parsed.searchParams)),
      true,
      'the signature still validates with r on the query',
    )
    assert.equal(host.querySelector('[data-state]')?.getAttribute('data-state'), 'ready')
  } finally {
    await unmount()
  }
})

test('keyboard Retry on a disabled instance row restores focus to the card or inspector panel', async () => {
  setPreviewLoadTimeoutForTests(20)
  const cardPath = '/tmp/disabled-card.otf'
  const inspectorPath = '/tmp/disabled-inspector.otf'
  installHungFonts([systemFontFamily(cardPath), systemFontFamily(inspectorPath)])
  const cardRow = {
    key: cardPath,
    label: 'Regular',
    systemPath: cardPath,
    weight: 400,
    italic: false,
    previewSample: 'Hamburgefonstiv',
  }
  const inspectorRow = {
    key: inspectorPath,
    label: 'Regular',
    systemPath: inspectorPath,
    weight: 400,
    italic: false,
    previewSample: 'Hamburgefonstiv',
  }
  const cardMount = await mount(
    createElement(
      'div',
      { 'data-family-key': 'Disabled Row' },
      createElement('button', { type: 'button' }, 'Family'),
      createElement(InstanceList, { rows: [cardRow] }),
    ),
  )
  try {
    await waitUntilFailed()
    const rowButton = cardMount.host.querySelector('ul button:not([data-preview-retry])')
    assert.equal(rowButton?.hasAttribute('disabled'), true)
    const retry = cardMount.host.querySelector('ul [data-preview-retry]')
    assert.equal(retry?.tagName, 'BUTTON')
    const cardButton = cardMount.host.querySelector('[data-family-key] > button')
    assert.equal(cardButton?.tagName, 'BUTTON')
    await act(async () => {
      ;(retry as HTMLButtonElement).focus()
    })
    assert.equal(document.activeElement, retry)
    await activateRetry(retry as HTMLButtonElement, 'Enter')
    assert.equal((retry as HTMLButtonElement).isConnected, false)
    assert.equal(document.activeElement, cardButton)
  } finally {
    await cardMount.unmount()
  }

  const panelMount = await mount(
    createElement(
      'div',
      { role: 'tabpanel', tabIndex: -1 },
      createElement(InstanceList, { rows: [inspectorRow] }),
    ),
  )
  try {
    await waitUntilFailed()
    const retry = panelMount.host.querySelector('[data-preview-retry]')
    assert.equal(retry?.tagName, 'BUTTON')
    const panel = panelMount.host.querySelector('[role="tabpanel"]')
    assert.ok(panel)
    await act(async () => {
      ;(retry as HTMLButtonElement).focus()
    })
    await activateRetry(retry as HTMLButtonElement, 'Enter')
    assert.equal((retry as HTMLButtonElement).isConnected, false)
    assert.equal(document.activeElement, panel)
  } finally {
    await panelMount.unmount()
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
  }
})

test('an in-flight preview re-sign keeps a retry counter bumped while it waits', async () => {
  const secret = 'retry-fetch-secret'
  ;(window as unknown as { fontButlerDesktop?: { getApiToken: () => Promise<string> } }).fontButlerDesktop = {
    getApiToken: async () => secret,
  }
  const entry = catalogEntry('retry-resign', [fontFace('Regular', 400)])
  const family = catalogFontFamily(entry.id)
  installFailOnceFonts()
  let arm = false
  let waiting = false
  let release = () => {}
  setPreviewCssWriteGateForTests(async () => {
    if (!arm) return
    waiting = true
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  function render(item: ReturnType<typeof catalogEntry>) {
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(FontFaceStyles, { entries: [item], catalog: [item], systemFaces: [] }),
        createElement(FetchProbe, { family }),
      ),
    )
  }
  try {
    await act(async () => {
      render(entry)
    })
    await waitForState(host, 'failed')
    arm = true
    const resigned = catalogEntry('retry-resign', [fontFace('Regular', 400)])
    resigned.sourceMtimeMs = 77
    resigned.sourceSize = 88
    await act(async () => {
      render(resigned)
    })
    for (let attempt = 0; attempt < 40 && !waiting; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(waiting, true, 'the re-sign is waiting to write preview CSS')
    await act(async () => {
      retryPreviewFamily(family)
      release()
    })
    const style = document.querySelector('style[data-font-butler-face="retry-resign"]')
    assert.ok(style)
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((style.textContent ?? '').includes('r=1') && (style.textContent ?? '').includes('77-88')) break
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
      })
    }
    const written = ruleUrlFromStyle(style, family)
    assert.match(written, /77-88/)
    assert.match(written, /[?&]r=1(?:&|$)/)
    const parsed = new URL(written, 'http://127.0.0.1')
    assert.equal(
      verifyFontPreviewQuery(secret, parsed.pathname, Object.fromEntries(parsed.searchParams)),
      true,
    )
    const installed = ruleUrlFromStyle(style, catalogFontFamily(entry.id, 'installed'))
    assert.equal(/[?&]r=\d+/.test(installed), false)
  } finally {
    release()
    setPreviewCssWriteGateForTests(null)
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})

test('the retry counter survives a preview stylesheet refresh', async () => {
  const secret = 'retry-fetch-secret'
  ;(window as unknown as { fontButlerDesktop?: { getApiToken: () => Promise<string> } }).fontButlerDesktop = {
    getApiToken: async () => secret,
  }
  setPreviewFaceRefreshForTests(30)
  const entry = catalogEntry('retry-refresh', [fontFace('Regular', 400)])
  const family = catalogFontFamily(entry.id)
  installFailOnceFonts()
  const { host, unmount } = await mount(
    createElement(
      'div',
      null,
      createElement(FontFaceStyles, { entries: [entry], catalog: [entry], systemFaces: [] }),
      createElement(FetchProbe, { family }),
    ),
  )
  try {
    await waitForState(host, 'failed')
    const style = document.querySelector('style[data-font-butler-face="retry-refresh"]')
    assert.ok(style)
    const retry = host.querySelector('[data-fetch-retry]')
    assert.equal(retry?.tagName, 'BUTTON')
    await act(async () => {
      ;(retry as HTMLButtonElement).click()
    })
    await waitForState(host, 'ready')
    assert.match(ruleUrlFromStyle(style, family), /[?&]r=1(?:&|$)/)
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((style.textContent ?? '').includes('r=1')) break
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
      })
    }
    assert.match(style.textContent ?? '', /[?&]r=1/)
    const refreshed = ruleUrlFromStyle(style, family)
    assert.match(refreshed, /[?&]r=1(?:&|$)/)
    const parsed = new URL(refreshed, 'http://127.0.0.1')
    assert.equal(
      verifyFontPreviewQuery(secret, parsed.pathname, Object.fromEntries(parsed.searchParams)),
      true,
    )
  } finally {
    setPreviewFaceRefreshForTests(15 * 60 * 1000)
    await unmount()
  }
})
