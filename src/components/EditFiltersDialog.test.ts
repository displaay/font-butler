import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { Window } from 'happy-dom'
import { defaultLibraryFilterGroups } from '../../shared/library-filter-groups.ts'
import type { LibraryFilterGroupPref } from '../../shared/library-filter-groups.ts'

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

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { EditFiltersDialog } = await import('./EditFiltersDialog.tsx')

function Harness({ initial }: { initial: LibraryFilterGroupPref[] }) {
  const [groups, setGroups] = React.useState(initial)
  return React.createElement(EditFiltersDialog, {
    open: true,
    groups,
    onClose: () => {},
    onChange: setGroups,
  })
}

function switches(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button[role="switch"]')] as HTMLButtonElement[]
}

test('Edit filters show controls are switches that hide and show a group', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const initial = defaultLibraryFilterGroups()

  await React.act(async () => {
    root.render(React.createElement(Harness, { initial }))
  })

  assert.equal(document.querySelector('input[type="checkbox"]'), null)
  const status = switches().find((button) => button.getAttribute('aria-label') === 'Show Status')
  const classification = switches().find(
    (button) => button.getAttribute('aria-label') === 'Show Classification',
  )
  assert.ok(status, 'expected a Show Status switch')
  assert.ok(classification, 'expected a Show Classification switch')
  assert.equal(switches().length, initial.length)
  assert.equal(status!.getAttribute('aria-checked'), 'true')
  assert.equal(classification!.getAttribute('aria-checked'), 'false')
  assert.match(status!.textContent ?? '', /Show/)

  await React.act(async () => {
    status!.click()
  })
  assert.equal(
    switches().find((button) => button.getAttribute('aria-label') === 'Show Status')?.getAttribute('aria-checked'),
    'false',
  )

  await React.act(async () => {
    classification!.click()
  })
  assert.equal(
    switches()
      .find((button) => button.getAttribute('aria-label') === 'Show Classification')
      ?.getAttribute('aria-checked'),
    'true',
  )

  await React.act(async () => {
    root.unmount()
  })
})

after(() => {
  view.close()
})
