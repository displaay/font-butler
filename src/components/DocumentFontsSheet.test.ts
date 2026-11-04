import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import type { DocumentFontReport } from '../../shared/document-project.ts'

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

function report(): DocumentFontReport {
  return {
    path: '/jobs/Brief.pdf',
    kind: 'pdf',
    fonts: [
      {
        postscriptName: 'Family-Bold',
        familyName: '',
        styleName: '',
        status: 'on',
        assetId: 'bold',
        installedFingerprint: 'fp-bold',
      },
      {
        postscriptName: 'Family-Regular',
        familyName: '',
        styleName: '',
        status: 'in-library-off',
        assetId: 'regular',
      },
      {
        postscriptName: 'NotInLibrary-Regular',
        familyName: '',
        styleName: '',
        status: 'missing',
      },
    ],
  }
}

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { DocumentFontsSheet } = await import('./DocumentFontsSheet.tsx')

async function mount(handlers?: {
  onActivateAvailable?: (ids: string[]) => void
  onCreateProject?: (name: string) => void
}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const activated: string[][] = []
  const created: string[] = []
  await act(async () => {
    root.render(
      createElement(DocumentFontsSheet, {
        report: report(),
        busy: false,
        onClose: () => {},
        onActivateAvailable: (ids: string[]) => {
          activated.push(ids)
          handlers?.onActivateAvailable?.(ids)
        },
        onCreateProject: (name: string) => {
          created.push(name)
          handlers?.onCreateProject?.(name)
        },
      }),
    )
  })
  const dialog = document.body.querySelector('[role="dialog"]')
  assert.ok(dialog)
  return {
    dialog,
    activated,
    created,
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

test('the document sheet groups on, off, and missing, and reveal stays on names', async () => {
  const { dialog, activated, created, unmount } = await mount()
  try {
    assert.equal(dialog.querySelector('[data-document-group="on"]')?.textContent?.includes('Family-Bold'), true)
    assert.equal(
      dialog.querySelector('[data-document-group="off"]')?.textContent?.includes('Family-Regular'),
      true,
    )
    const missing = dialog.querySelector('[data-document-group="missing"]')
    assert.ok(missing)
    assert.equal(missing.textContent?.includes('NotInLibrary-Regular'), true)
    assert.equal(missing.textContent?.includes('no file to show'), true)
    assert.equal(missing.querySelector('[data-path]'), null)
    assert.equal(missing.textContent?.includes('/jobs/Brief.pdf'), false)

    const reveal = buttonNamed(dialog, 'Reveal missing')
    assert.ok(reveal)
    await act(async () => {
      reveal.click()
    })
    assert.equal(missing.getAttribute('data-revealed'), 'true')
    assert.equal(document.activeElement, missing)

    const activate = buttonNamed(dialog, 'Activate available')
    assert.ok(activate)
    await act(async () => {
      activate.click()
    })
    assert.deepEqual(activated, [['regular']])

    const create = buttonNamed(dialog, 'Create project')
    assert.ok(create)
    await act(async () => {
      create.click()
    })
    assert.deepEqual(created, ['Brief'])
  } finally {
    await unmount()
  }
})
