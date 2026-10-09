import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { PREVIEW_LOAD_TIMEOUT_MS, setPreviewLoadTimeoutForTests } from '../lib/previewReady.ts'

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

test('a failed preview shows a retry control and does not paint the unloaded family', async () => {
  setPreviewLoadTimeoutForTests(20)
  let loads = 0
  const fonts = {
    check: () => false,
    load: () => {
      loads += 1
      return new Promise(() => {})
    },
    addEventListener() {},
    removeEventListener() {},
    forEach(callback: (face: { family: string; weight: number; style: string; status: string }) => void) {
      callback({ family: 'fc-ui-error', weight: 400, style: 'normal', status: 'loading' })
    },
  }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AaPreview } = await import('./AaPreview.tsx')

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(
        createElement(AaPreview, {
          family: 'fc-ui-error',
          sample: 'Hamburgefonstiv',
          wait: true,
        }),
      )
    })
    assert.equal(loads, 1)
    assert.equal(host.querySelector('[role="alert"]'), null)
    assert.equal(host.textContent?.includes('Hamburgefonstiv'), false)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const alert = host.querySelector('[role="alert"]')
    assert.ok(alert, 'failed preview shows an error')
    assert.match(alert.textContent ?? '', /Failed/)
    const retry = alert.querySelector('button')
    assert.equal(retry?.textContent, 'Retry')
    assert.equal(host.textContent?.includes('Hamburgefonstiv'), false)
    assert.equal(host.querySelector('[style*="fc-ui-error"]'), null)

    await act(async () => {
      retry?.click()
    })
    assert.equal(loads, 2)
    assert.equal(host.querySelector('[role="alert"]'), null)
    assert.equal(host.querySelector('[aria-label="Loading preview"]') != null, true)
    assert.equal(host.textContent?.includes('Hamburgefonstiv'), false)
    assert.equal(host.querySelector('[style*="fc-ui-error"]'), null)
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
  }
})
