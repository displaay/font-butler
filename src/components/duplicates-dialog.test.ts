import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import type { CatalogEntry, DuplicateWarning, FontFaceInfo } from '../lib/types.ts'

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

function face(): FontFaceInfo {
  return {
    familyName: 'Pitch',
    styleName: 'Regular',
    fullName: 'Pitch Regular',
    postscriptName: 'Pitch-Regular',
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function activeEntry(): CatalogEntry {
  return {
    id: 'active',
    sourcePath: '/Users/me/Library/Fonts/FontBase/Pitch-Regular.otf',
    sourceMtimeMs: 1,
    sourceSize: 8,
    status: 'installed',
    faces: [face()],
    format: 'otf',
    sourceFingerprint: 'deadbeefcafef00d',
    previewSample: 'Aa',
    addedAt: 1,
    updatedAt: 1,
    installedPath: '/Users/me/Library/Fonts/FontBase/Pitch-Regular.otf',
  }
}

function warning(): DuplicateWarning {
  return {
    id: 'dup-1',
    path: '/Users/me/Fonts/Pitch.otf',
    fingerprint: 'deadbeefcafef00d',
    familyName: 'Pitch',
    format: 'otf',
    incomingVersion: '1.000',
    conflictingEntryIds: ['active'],
    activeEntryId: 'active',
    notifyKey: 'notify-key',
    createdAt: 1,
    updatedAt: 1,
  }
}

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { DuplicatesDialog } = await import('./DuplicatesDialog.tsx')

async function mount(onResolve: (id: string, choice: string, familyName?: string) => void = () => {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(DuplicatesDialog, {
        open: true,
        warnings: [warning()],
        entries: [activeEntry()],
        busy: false,
        onClose: () => {},
        onResolve,
        onResolveBatch: () => {},
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

test('a duplicate card shows the installed font and the incoming file without hashes', async () => {
  const { dialog, unmount } = await mount()
  try {
    const text = dialog.textContent ?? ''
    assert.match(text, /Installed now/)
    assert.match(text, /Incoming/)
    assert.match(text, /Pitch · OTF/)
    assert.match(text, /Version 1\.000/)
    assert.match(text, /FontBase\/Pitch-Regular\.otf/)
    assert.match(text, /\/Users\/me\/Fonts\/Pitch\.otf/)
    assert.match(text, /Same bytes/)
    assert.equal(text.includes('Watched'), false)
    assert.equal(text.includes('Fingerprint'), false)
    assert.equal(text.includes('deadbeef'), false)
    assert.equal(text.includes('Modified'), false)
    assert.equal(text.includes('macos'), false)
    assert.equal(dialog.querySelector('#duplicate-name-dup-1'), null)
    for (const name of ['Replace active', 'Add inactive copy', 'Install as…', 'Switch', 'Skip', 'Skip all']) {
      assert.ok(buttonNamed(dialog, name), name)
    }
    assert.ok(buttonNamed(dialog, 'Dismiss same-byte matches (1)'))
  } finally {
    await unmount()
  }
})

test('Install as asks for a family name only after it is selected', async () => {
  const calls: Array<{ id: string; choice: string; familyName?: string }> = []
  const { dialog, unmount } = await mount((id, choice, familyName) => {
    calls.push({ id, choice, familyName })
  })
  try {
    const open = buttonNamed(dialog, 'Install as…')
    assert.ok(open)
    await act(async () => {
      open.click()
    })
    const input = dialog.querySelector('#duplicate-name-dup-1')
    assert.ok(input instanceof view.HTMLInputElement)
    assert.equal(buttonNamed(dialog, 'Install'), undefined)

    const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set
    assert.ok(setter)
    await act(async () => {
      setter.call(input, 'As Pitch')
      input.dispatchEvent(new view.Event('input', { bubbles: true }))
    })
    const install = buttonNamed(dialog, 'Install')
    assert.ok(install)
    await act(async () => {
      install.click()
    })
    assert.deepEqual(calls, [{ id: 'dup-1', choice: 'install-as', familyName: 'As Pitch' }])
  } finally {
    await unmount()
  }
})
