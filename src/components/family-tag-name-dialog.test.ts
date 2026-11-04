import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { TAG_COLOR_CHOICES } from '../../shared/family-tags.ts'

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

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)
}

function colorButton(root: ParentNode, color: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="Color ${color}"]`)
  assert.ok(button, color)
  return button
}

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { FamilyTagNameDialog } = await import('./FamilyTags.tsx')

const firstColor = TAG_COLOR_CHOICES[0]!

async function mount(onSubmit: (name: string, color: string) => void = () => {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(FamilyTagNameDialog, {
        open: true,
        mode: 'create',
        initialName: 'Client',
        onOpenChange: () => {},
        onSubmit,
      }),
    )
  })
  const dialog = document.body.querySelector('[role="dialog"]')
  assert.ok(dialog)
  return {
    dialog,
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

test('the new tag dialog offers the palette and saves the first color by default', async () => {
  const submitted: Array<{ name: string; color: string }> = []
  const { dialog, unmount } = await mount((name, color) => {
    submitted.push({ name, color })
  })
  try {
    assert.match(dialog.textContent ?? '', /New tag/)
    assert.match(dialog.textContent ?? '', /Color/)
    assert.equal(TAG_COLOR_CHOICES.length > 1, true)
    for (const color of TAG_COLOR_CHOICES) {
      const button = colorButton(dialog, color)
      assert.equal(button.getAttribute('aria-pressed'), color === firstColor ? 'true' : 'false')
    }
    const save = buttonNamed(dialog, 'Save')
    assert.ok(save)
    assert.equal(save.disabled, false)
    await act(async () => {
      save.click()
    })
    assert.deepEqual(submitted, [{ name: 'Client', color: firstColor }])
  } finally {
    await unmount()
  }
})

test('the new tag dialog saves the color the user picks', async () => {
  const submitted: Array<{ name: string; color: string }> = []
  const { dialog, unmount } = await mount((name, color) => {
    submitted.push({ name, color })
  })
  try {
    const picked = TAG_COLOR_CHOICES[4]!
    await act(async () => {
      colorButton(dialog, picked).click()
    })
    assert.equal(colorButton(dialog, picked).getAttribute('aria-pressed'), 'true')
    assert.equal(colorButton(dialog, firstColor).getAttribute('aria-pressed'), 'false')
    const save = buttonNamed(dialog, 'Save')
    assert.ok(save)
    await act(async () => {
      save.click()
    })
    assert.deepEqual(submitted, [{ name: 'Client', color: picked }])
  } finally {
    await unmount()
  }
})
