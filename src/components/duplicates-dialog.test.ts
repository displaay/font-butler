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

test('Library Health section shows three groups with keeper vs extra and a report-only finding', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const fixes: string[] = []
  const report = {
    scannedAt: 1,
    counts: { 'installed-twice': 1, 'missing-source': 1, damaged: 1 },
    findings: [
      {
        id: 'h1',
        group: 'installed-twice' as const,
        faceIdentityKey: 'Pitch-Regular',
        format: 'otf',
        familyName: 'Pitch',
        entryIds: ['active', 'extra'],
        keeperEntryId: 'active',
        copies: [
          { entryId: 'active', path: '/Fonts/Pitch.otf', kind: 'installed' as const, live: true, verifiedGood: true, damaged: false, role: 'keeper' as const },
          { entryId: 'extra', path: '/Fonts/Copy/Pitch.otf', kind: 'installed' as const, live: true, verifiedGood: true, damaged: false, role: 'extra' as const },
        ],
        actions: [{ kind: 'park-extra' as const, entryId: 'extra', label: 'Park extra copy' }],
        reportOnly: false,
      },
      {
        id: 'h2',
        group: 'missing-source' as const,
        faceIdentityKey: 'Pitch-Regular',
        format: 'otf',
        familyName: 'Pitch',
        entryIds: ['missing'],
        copies: [],
        actions: [{ kind: 'relink' as const, entryId: 'missing', label: 'Relink to the moved file…' }],
        reportOnly: false,
      },
      {
        id: 'h3',
        group: 'damaged' as const,
        faceIdentityKey: 'Pitch-Regular',
        format: 'otf',
        familyName: 'Pitch',
        entryIds: ['bad'],
        copies: [
          { entryId: 'bad', path: '/Fonts/Bad.otf', kind: 'source' as const, live: false, verifiedGood: false, damaged: true, reason: 'The font file is shorter than an sfnt header.', role: 'copy' as const },
        ],
        actions: [],
        reportOnly: true,
        reportReason: 'This damaged file is the only copy of this face, so it is left exactly where it is — never deleted.',
      },
    ],
  }
  await act(async () => {
    root.render(
      createElement(DuplicatesDialog, {
        open: true,
        warnings: [],
        entries: [activeEntry()],
        busy: false,
        onClose: () => {},
        onResolve: () => {},
        onResolveBatch: () => {},
        healthReport: report,
        onScanHealth: () => {},
        onHealthFix: (action: { kind: string }) => fixes.push(action.kind),
        onHealthRelink: () => fixes.push('relink-ui'),
      }),
    )
  })
  try {
    const dialog = document.body.querySelector('[role="dialog"]')
    assert.ok(dialog)
    const text = dialog.textContent ?? ''
    assert.match(text, /Library Health/)
    assert.match(text, /Installed twice \(1\)/)
    assert.match(text, /Missing source file \(1\)/)
    assert.match(text, /Damaged \/ unreadable \(1\)/)
    assert.match(text, /Keeper · \/Fonts\/Pitch\.otf · Verified good/)
    assert.match(text, /Extra copy · \/Fonts\/Copy\/Pitch\.otf/)
    assert.match(text, /Report only — no safe fix/)
    const park = buttonNamed(dialog, 'Park extra copy')
    assert.ok(park)
    await act(async () => {
      park.click()
    })
    assert.deepEqual(fixes, ['park-extra'])
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
})
