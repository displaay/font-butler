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
globalThis.window = view
globalThis.document = view.document
for (const key of new Set([
  ...Object.getOwnPropertyNames(view),
  ...Object.getOwnPropertyNames(Object.getPrototypeOf(view)),
])) {
  if (!/^[A-Z]/.test(key) || keepNodeBuiltins.has(key)) continue
  try {
    ;(globalThis as Record<string, unknown>)[key] = (view as unknown as Record<string, unknown>)[key]
  } catch {
    // Some window accessors are not writable from Node.
  }
}
globalThis.getComputedStyle = view.getComputedStyle.bind(view)
globalThis.requestAnimationFrame = view.requestAnimationFrame.bind(view)
globalThis.cancelAnimationFrame = view.cancelAnimationFrame.bind(view)
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true


const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { FamilyDetailsEditor, FamilyRatingBadge } = await import('./FamilyDetails.tsx')

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)
}

test('family details editor views and edits rating and comment', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const ratings: Array<[string, number | null]> = []
  const comments: Array<[string, string]> = []
  await act(async () => {
    root.render(
      createElement('div', null, [
        createElement(FamilyDetailsEditor, {
          key: 'editor',
          familyKey: 'Acme Sans',
          detail: { familyKey: 'Acme Sans', rating: 3, comment: 'Old note' },
          onRating: (key: string, rating: number | null) => ratings.push([key, rating]),
          onComment: (key: string, comment: string) => comments.push([key, comment]),
        }),
        createElement(FamilyRatingBadge, { key: 'badge', rating: 3 }),
      ]),
    )
  })
  try {
    assert.equal(host.querySelector('[data-family-rating="3"]')?.textContent?.includes('3'), true)
    const four = host.querySelector('[aria-label="4 stars"]') as HTMLButtonElement
    assert.ok(four)
    await act(async () => four.click())
    assert.deepEqual(ratings, [['Acme Sans', 4]])
    const three = host.querySelector('[aria-label="3 stars"]') as HTMLButtonElement
    await act(async () => three.click())
    assert.deepEqual(ratings[1], ['Acme Sans', null])

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement
    assert.equal(textarea.value, 'Old note')
    const setter = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, 'New note')
    textarea.dispatchEvent(new view.Event('input', { bubbles: true }))
    const save = buttonNamed(host, 'Save comment')
    assert.ok(save)
    await act(async () => save.click())
    assert.deepEqual(comments, [['Acme Sans', 'New note']])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('an unsaved comment draft is discarded when the family changes', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const comments: Array<[string, string]> = []
  const render = (familyKey: string, comment: string, rating: number) =>
    createElement(FamilyDetailsEditor, {
      familyKey,
      detail: { familyKey, rating, comment },
      onRating: () => {},
      onComment: (key: string, text: string) => comments.push([key, text]),
    })
  await act(async () => {
    root.render(render('Acme Sans', 'Sans note', 5))
  })
  try {
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement
    assert.equal(textarea.value, 'Sans note')
    const setter = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, 'Unsaved draft for Sans')
    textarea.dispatchEvent(new view.Event('input', { bubbles: true }))
    const save = buttonNamed(host, 'Save comment')
    assert.ok(save)
    assert.equal(save.disabled, false)

    // Switch families without saving, as the Inspector does.
    await act(async () => {
      root.render(render('Acme Serif', 'Serif note', 2))
    })
    assert.equal(textarea.value, 'Serif note')
    assert.equal(save.disabled, true)
    await act(async () => save.click())
    assert.deepEqual(comments, [])
    assert.equal(host.querySelector('[aria-label="2 stars"]')?.getAttribute('aria-checked'), 'true')
    assert.equal(host.querySelector('[aria-label="5 stars"]')?.getAttribute('aria-checked'), 'false')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
