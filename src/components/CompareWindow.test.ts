import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { addCompareFamilies, emptyCompare, familyIdForName, type CompareFace, type CompareFamily } from '../../shared/compare.ts'
import type { CompareLibraryFamily } from './CompareWindow.tsx'

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
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(view as unknown as { fontButlerDesktop?: { getApiToken: () => Promise<string> } }).fontButlerDesktop = {
  getApiToken: async () => 'test-token',
}

function face(filePath: string, styleName: string): CompareFace {
  return {
    id: `${filePath}#0`,
    styleName,
    weight: 400,
    italic: false,
    postscriptName: styleName,
    filePath,
    faceIndex: 0,
  }
}

function family(name: string, faces: CompareFace[]): CompareFamily {
  return { id: familyIdForName(name), name, faces }
}

const handlers = {
  onLayout: () => {},
  onText: () => {},
  onSize: () => {},
  onClose: () => {},
  onAddFamilies: () => {},
  onRemoveFamily: () => {},
  onRemoveEntry: () => {},
  onStyle: () => {},
  onAnotherStyle: () => {},
  onTint: () => {},
  onMove: () => {},
  onOpenFiles: () => {},
}

test('compare is a modal, moves focus in, and restores it on close', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CompareWindow } = await import('./CompareWindow.tsx')

  function Harness({ open }: { open: boolean }) {
    return createElement(
      'div',
      null,
      createElement('button', { type: 'button', 'data-library': '' }, 'Library'),
      open
        ? createElement(CompareWindow, {
            ...handlers,
            model: emptyCompare(),
            layout: 'stacked',
            text: '',
            size: 72,
            libraryFamilies: [],
          })
        : null,
    )
  }

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(createElement(Harness, { open: false }))
    })
    const library = host.querySelector('[data-library]')
    assert.ok(library instanceof view.HTMLElement)
    library.focus()
    assert.equal(document.activeElement, library)

    await act(async () => {
      root.render(createElement(Harness, { open: true }))
    })
    const dialog = host.querySelector('[role="dialog"]')
    assert.ok(dialog instanceof view.HTMLElement)
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    assert.equal(library.inert, true)
    assert.ok(dialog.contains(document.activeElement))

    await act(async () => {
      root.render(createElement(Harness, { open: false }))
    })
    assert.equal(library.inert, false)
    assert.equal(document.activeElement, library)
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})

test('overlay samples share a baseline', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CompareWindow } = await import('./CompareWindow.tsx')
  const model = addCompareFamilies(emptyCompare(), [
    family('Acme', [face('/Fonts/Acme.ttf', 'Regular')]),
    family('Other', [face('/Fonts/Other.ttf', 'Regular')]),
  ])
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(
        createElement(CompareWindow, {
          ...handlers,
          model,
          layout: 'overlay',
          text: 'Hamburgefonstiv',
          size: 72,
          libraryFamilies: [],
        }),
      )
    })
    const stage = host.querySelector('[data-compare-overlay]')
    assert.ok(stage)
    assert.match(stage.className, /grid/)
    const samples = stage.querySelectorAll('.compare-overlay-ink')
    assert.equal(samples.length, 2)
    for (const sample of samples) {
      assert.match(sample.className, /self-baseline/)
      assert.doesNotMatch(sample.className, /absolute/)
    }
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})

test('add families removes a custom name by the inspected family id', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CompareWindow } = await import('./CompareWindow.tsx')
  const removed: string[] = []
  const model = addCompareFamilies(emptyCompare(), [family('Acme', [face('/Fonts/Acme.ttf', 'Regular')])])
  const libraryFamilies: CompareLibraryFamily[] = [
    { name: 'My Acme', familyId: familyIdForName('Acme'), paths: ['/Fonts/Acme.ttf'] },
  ]
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(
        createElement(CompareWindow, {
          ...handlers,
          model,
          layout: 'stacked',
          text: '',
          size: 72,
          libraryFamilies,
          onRemoveFamily: (familyId: string) => {
            removed.push(familyId)
          },
        }),
      )
    })
    const add = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Add Families'))
    assert.ok(add)
    await act(async () => {
      add.dispatchEvent(new view.MouseEvent('click', { bubbles: true }))
    })
    const row = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('My Acme'))
    assert.ok(row)
    assert.match(row.textContent ?? '', /✓/)
    await act(async () => {
      row.dispatchEvent(new view.MouseEvent('click', { bubbles: true }))
    })
    assert.deepEqual(removed, [familyIdForName('Acme')])
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})
