import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import type { CatalogEntry, FamilyGroup, FontFaceInfo } from '../lib/types.ts'
import { DEFAULT_TEXT_PREVIEW, textPreviewLanguage } from '../lib/textPreview.ts'

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

function fontFace(familyName: string): FontFaceInfo {
  return {
    familyName,
    styleName: 'Regular',
    fullName: `${familyName} Regular`,
    postscriptName: familyName.replaceAll(' ', ''),
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function catalogEntry(id: string, familyName: string): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.ttf`,
    sourceMtimeMs: 1,
    sourceSize: 8,
    status: 'installed',
    faces: [fontFace(familyName)],
    format: 'ttf',
    previewSample: 'Aa',
    addedAt: 1,
    updatedAt: 1,
  }
}

function familyGroup(entry: CatalogEntry, familyName: string): FamilyGroup {
  return {
    key: familyName,
    familyName,
    entries: [entry],
    faces: entry.faces,
    isVariable: false,
    instanceCount: 1,
    status: 'installed',
    previewEntryId: entry.id,
    addedAt: 1,
  }
}

const { createElement, useState, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { LibraryCard } = await import('./LibraryCard.tsx')
const { ViewOptions } = await import('./ViewOptions.tsx')
const { TooltipProvider } = await import('./ui/tooltip.tsx')

function libraryProps(group: FamilyGroup) {
  const noop = () => {}
  return {
    group,
    layout: 'text' as const,
    previewSize: 4,
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
    dragIds: [group.entries[0]?.id ?? ''],
    projectFamilyNames: [group.familyName],
    onAddToProject: noop,
    onRemoveFromProject: noop,
    onCreateProjectFromCard: noop,
    onFontDragStart: noop,
    onFontDragEnd: noop,
  }
}

function SharedSamples() {
  const [text, setText] = useState(DEFAULT_TEXT_PREVIEW)
  const alpha = familyGroup(catalogEntry('alpha', 'Alpha Sans'), 'Alpha Sans')
  const beta = familyGroup(catalogEntry('beta', 'Beta Serif'), 'Beta Serif')
  return createElement(
    'div',
    null,
    createElement(LibraryCard, { ...libraryProps(alpha), sampleText: text, onSampleTextChange: setText }),
    createElement(LibraryCard, { ...libraryProps(beta), sampleText: text, onSampleTextChange: setText }),
  )
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

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(textarea) as object
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new view.Event('input', { bubbles: true }))
}

test('editing one text card rewrites the sample on every card', async () => {
  const { host, unmount } = await mount(createElement(SharedSamples))
  try {
    const fields = [...host.querySelectorAll('textarea')]
    assert.equal(fields.length, 2)
    assert.equal(fields[0]?.value, DEFAULT_TEXT_PREVIEW)
    assert.equal(fields[1]?.value, DEFAULT_TEXT_PREVIEW)
    assert.equal(fields[0]?.getAttribute('aria-label'), 'Sample text for Alpha Sans')
    await act(async () => {
      setTextarea(fields[0] as HTMLTextAreaElement, 'Pack my box with five dozen liquor jugs.')
    })
    const next = [...host.querySelectorAll('textarea')]
    assert.equal(next[0]?.value, 'Pack my box with five dozen liquor jugs.')
    assert.equal(next[1]?.value, 'Pack my box with five dozen liquor jugs.')
  } finally {
    await unmount()
  }
})

test('the language menu replaces the shared sample with that pangram', async () => {
  let chosen = ''
  const { host, unmount } = await mount(
    createElement(ViewOptions, {
      layout: 'text',
      onLayoutChange: () => {},
      sortMode: 'name',
      onSortModeChange: () => {},
      showSources: false,
      onShowSourcesChange: () => {},
      showAdded: false,
      onShowAddedChange: () => {},
      showInstanceCounts: false,
      onShowInstanceCountsChange: () => {},
      hideDestinations: false,
      onHideDestinationsChange: () => {},
      hideFormats: false,
      onHideFormatsChange: () => {},
      previewSize: 4,
      onPreviewSizeChange: () => {},
      sampleLanguage: 'en',
      onSampleLanguageChange: (id: string) => {
        chosen = id
      },
    }),
  )
  try {
    assert.ok(host.querySelector('[aria-label="Preview size"]'))
    assert.ok(host.querySelector('[aria-label="Text view"]'))
    const opener = host.querySelector('[data-sample-language]')
    assert.ok(opener)
    await act(async () => {
      opener?.dispatchEvent(new view.MouseEvent('click', { bubbles: true }))
    })
    const menu = host.querySelector('[data-sample-language-menu]')
    assert.ok(menu)
    const french = [...menu.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes('French'))
    assert.ok(french)
    await act(async () => {
      french.dispatchEvent(new view.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(chosen, 'fr')
    assert.match(textPreviewLanguage('fr').text, /whisky/)
    assert.equal(host.querySelector('[data-sample-language-menu]'), null)
  } finally {
    await unmount()
  }
})
