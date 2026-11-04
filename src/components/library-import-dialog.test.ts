import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import type { LibraryImportPlan } from '../../shared/library-import.ts'

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
const { LibraryImportPlanView } = await import('./LibraryImportDialog.tsx')

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)
}

function plan(): LibraryImportPlan {
  return {
    id: 'plan-1',
    createdAt: 1,
    sourceApp: 'font-book',
    sourceName: 'Client Work.collection',
    sets: [
      {
        id: 'set-0',
        name: 'Client Work',
        kind: 'manual',
        collision: true,
        existingProjectId: 'existing-1',
        memberAssetIds: ['a', 'b'],
        alreadyMemberAssetIds: ['a'],
        unresolved: [{ raw: 'Missing Family', postscriptName: '', familyName: 'Missing Family', sourceFile: '' }],
        untranslatableRules: [],
        defaultChoice: 'merge',
      },
      {
        id: 'set-1',
        name: 'Sans Text',
        kind: 'manual',
        collision: false,
        memberAssetIds: [],
        alreadyMemberAssetIds: [],
        unresolved: [],
        disabled: true,
        untranslatableRules: ['Manufacturer contains'],
        defaultChoice: 'skip',
      },
    ],
    labels: [
      { id: 'label-0', name: 'Client', existingTagId: 'tag-1', familyKeys: ['Acme Serif'], unresolvedCount: 0 },
    ],
    ratings: [{ familyKey: 'Acme Sans', stars: 5, existingRating: null }],
    comments: [{ familyKey: 'Acme Sans', text: 'Hero sans', existingComment: null }],
    unsupported: [
      { concept: 'sets', reason: 'FontExplorer X data could not be read.', count: null, detail: 'Sets could not be read.' },
    ],
    warnings: [],
    summary: { sets: 1, smartSets: 0, labels: 1, reusedLabels: 1, unresolvedFonts: 1, ratings: 1, comments: 1 },
  }
}

test('library import preview shows collisions, unresolved, untranslatable rules and unsupported items', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const chosen: Array<[string, string]> = []
  await act(async () => {
    root.render(
      createElement(LibraryImportPlanView, {
        plan: plan(),
        choices: { 'set-0': 'merge', 'set-1': 'skip' },
        onChoice: (setId: string, choice: string) => chosen.push([setId, choice]),
      }),
    )
  })
  try {
    const text = host.textContent ?? ''
    assert.match(text, /A project with this name already exists/)
    assert.match(text, /Unresolved: Missing Family/)
    assert.match(text, /Manufacturer contains/)
    assert.match(text, /Skipped: a rule below cannot be translated/)
    assert.match(text, /reuse existing tag/)
    assert.match(text, /Acme Sans: 5 stars/)
    assert.match(text, /Hero sans/)
    const unsupported = host.querySelector('[data-library-import-unsupported]')
    assert.ok(unsupported)
    assert.match(unsupported.textContent ?? '', /Count could not be read/)
    assert.match(unsupported.textContent ?? '', /could not be read/)

    const merge = buttonNamed(host, 'Merge members')
    assert.ok(merge)
    await act(async () => merge.click())
    assert.deepEqual(chosen, [['set-0', 'merge']])

    assert.equal(buttonNamed(host, 'Create empty manual project'), undefined)
    assert.equal(host.querySelector('[data-library-import-disabled]') !== null, true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
