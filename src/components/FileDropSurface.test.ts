import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'

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

function drag(
  target: Element,
  type: string,
  types: string[],
  relatedTarget: EventTarget | null = document.body,
) {
  const event = new view.DragEvent(type, {
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types, dropEffect: 'none' },
  })
  target.dispatchEvent(event)
}

test('file drop overlay ignores text, hides when the pointer leaves the window, and hides on Escape', async () => {
  const { createElement, useState, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { FileDropSurface } = await import('./FileDropSurface.tsx')

  function Harness() {
    const [dragging, setDragging] = useState(false)
    return createElement(
      FileDropSurface,
      {
        dragging,
        label: 'Drop fonts or folders to add them',
        onDraggingChange: setDragging,
        onDrop: () => {},
      },
      createElement('div', { 'data-card': '' }, 'library'),
    )
  }

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const overlay = () => host.querySelector('[data-file-drop-overlay]')
  try {
    await act(async () => {
      root.render(createElement(Harness))
    })
    const surface = host.firstElementChild
    assert.ok(surface)
    const card = host.querySelector('[data-card]')
    assert.ok(card)

    await act(async () => {
      drag(surface, 'dragenter', ['text/plain'])
    })
    assert.equal(overlay(), null)

    await act(async () => {
      drag(surface, 'dragenter', ['Files'])
    })
    assert.ok(overlay(), 'a file drag shows the overlay')
    assert.match(overlay()?.textContent ?? '', /Drop fonts or folders/)

    await act(async () => {
      drag(card, 'dragenter', ['Files'], surface)
      drag(card, 'dragleave', ['Files'], surface)
    })
    assert.ok(overlay(), 'moving onto a card keeps the overlay')

    await act(async () => {
      drag(surface, 'dragleave', ['Files'], null)
    })
    assert.equal(overlay(), null)

    await act(async () => {
      drag(surface, 'dragenter', ['Files'])
    })
    assert.ok(overlay())

    await act(async () => {
      window.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(overlay(), null)
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})
