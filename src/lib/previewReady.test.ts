import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  invalidatePreviewReadyFamilies,
  isGenericPreviewFamily,
  isPreviewFontReady,
  normalizePreviewFamily,
  notifyPreviewCssMounted,
  previewFacesFailed,
  subscribePreviewFonts,
} from './previewReady.ts'

type MockFace = { family: string; weight?: number | string; style?: string; status?: string }

function mockFonts(options: {
  check?: boolean
  faces?: MockFace[]
  onLoad?: () => void
  /** Replaces the default load() that resolves empty. */
  load?: () => Promise<unknown>
}): () => void {
  const faces = options.faces ?? []
  const fonts = {
    check: () => Boolean(options.check),
    load: () => {
      options.onLoad?.()
      return options.load ? options.load() : Promise.resolve([])
    },
    addEventListener() {},
    removeEventListener() {},
    forEach(callback: (face: MockFace) => void) {
      for (const face of faces) callback(face)
    },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: { fonts },
  })
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, 'document', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
}

test('generic families are treated as ready so UI chrome is not blocked', () => {
  assert.equal(isGenericPreviewFamily('ui-sans-serif'), true)
  assert.equal(isGenericPreviewFamily('system-ui'), true)
  assert.equal(isGenericPreviewFamily(''), true)
  assert.equal(isGenericPreviewFamily('fc-abc'), false)
  assert.equal(isPreviewFontReady('ui-sans-serif'), true)
})

test('normalizePreviewFamily strips quotes', () => {
  assert.equal(normalizePreviewFamily('"fc-id"'), 'fc-id')
  assert.equal(normalizePreviewFamily("'sys-ab'"), 'sys-ab')
})

test('custom families are not ready without a loaded FontFace', () => {
  assert.equal(isPreviewFontReady('fc-missing'), false)
})

test('fonts.check() true is ignored until a matching FontFace is mounted', () => {
  const restore = mockFonts({ check: true, faces: [] })
  try {
    assert.equal(isPreviewFontReady('fc-abc'), false)
  } finally {
    restore()
  }
})

test('matching FontFace plus fonts.check() reports the preview ready', () => {
  const restore = mockFonts({ check: true, faces: [{ family: '"fc-abc"' }] })
  try {
    assert.equal(isPreviewFontReady('fc-abc'), true)
  } finally {
    restore()
  }
})

test('matching FontFace still waits while fonts.check() is false', () => {
  const restore = mockFonts({ check: false, faces: [{ family: 'fc-waiting' }] })
  try {
    assert.equal(isPreviewFontReady('fc-waiting'), false)
  } finally {
    restore()
  }
})

test('notifyPreviewCssMounted wakes waiting preview listeners', () => {
  let calls = 0
  const restore = mockFonts({ check: false, faces: [] })
  try {
    const stop = subscribePreviewFonts(() => {
      calls += 1
    })
    notifyPreviewCssMounted()
    assert.equal(calls, 1)
    stop()
  } finally {
    restore()
  }
})

test('fonts.load waits until a matching FontFace is mounted', () => {
  let loads = 0
  const restoreEmpty = mockFonts({
    check: false,
    faces: [],
    onLoad: () => {
      loads += 1
    },
  })
  try {
    assert.equal(isPreviewFontReady('fc-visible'), false)
    assert.equal(loads, 0)
  } finally {
    restoreEmpty()
  }
  const restoreMounted = mockFonts({
    check: false,
    faces: [{ family: 'fc-visible' }],
    onLoad: () => {
      loads += 1
    },
  })
  try {
    assert.equal(isPreviewFontReady('fc-visible'), false)
    assert.equal(loads, 1)
    assert.equal(isPreviewFontReady('fc-visible'), false)
    assert.equal(loads, 1)
  } finally {
    restoreMounted()
  }
})

test('settled preview loads stay cached so system cards cannot retry-storm', async () => {
  let loads = 0
  const restore = mockFonts({
    check: false,
    faces: [{ family: 'fc-reload' }],
    onLoad: () => {
      loads += 1
    },
  })
  try {
    assert.equal(isPreviewFontReady('fc-reload'), false)
    assert.equal(loads, 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(isPreviewFontReady('fc-reload'), false)
    assert.equal(loads, 1)
  } finally {
    restore()
  }
})

test('ready previews stay cached while the face is still mounted', () => {
  const restoreReady = mockFonts({ check: true, faces: [{ family: 'fc-cached' }] })
  try {
    assert.equal(isPreviewFontReady('fc-cached'), true)
  } finally {
    restoreReady()
  }
  const restoreRemount = mockFonts({ check: false, faces: [{ family: 'fc-cached' }] })
  try {
    assert.equal(isPreviewFontReady('fc-cached'), true)
  } finally {
    restoreRemount()
  }
  const restorePruned = mockFonts({ check: false, faces: [] })
  try {
    assert.equal(isPreviewFontReady('fc-cached'), false)
  } finally {
    restorePruned()
  }
})

test('invalidatePreviewReadyFamilies drops cached readiness per family', () => {
  const restoreReady = mockFonts({
    check: true,
    faces: [{ family: 'fc-drop' }, { family: 'fc-keep' }],
  })
  try {
    assert.equal(isPreviewFontReady('fc-drop'), true)
    assert.equal(isPreviewFontReady('fc-keep'), true)
  } finally {
    restoreReady()
  }
  invalidatePreviewReadyFamilies(['fc-drop'])
  const restoreRemount = mockFonts({
    check: false,
    faces: [{ family: 'fc-drop' }, { family: 'fc-keep' }],
  })
  try {
    assert.equal(isPreviewFontReady('fc-drop'), false)
    assert.equal(isPreviewFontReady('fc-keep'), true)
  } finally {
    restoreRemount()
  }
})

test('invalidating a family lets fonts.load run again after a prune', async () => {
  let loads = 0
  const restore = mockFonts({
    check: false,
    faces: [{ family: 'fc-pruned' }],
    onLoad: () => {
      loads += 1
    },
  })
  try {
    assert.equal(isPreviewFontReady('fc-pruned'), false)
    assert.equal(loads, 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(isPreviewFontReady('fc-pruned'), false)
    assert.equal(loads, 1)
    invalidatePreviewReadyFamilies(['fc-pruned'])
    assert.equal(isPreviewFontReady('fc-pruned'), false)
    assert.equal(loads, 2)
  } finally {
    restore()
  }
})

test('a face whose file fails to load stops waiting instead of spinning forever', async () => {
  const faces = [{ family: '"fc-gone"', status: 'error' }]
  const restore = mockFonts({ check: false, faces })
  try {
    assert.equal(isPreviewFontReady('fc-gone'), false)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(isPreviewFontReady('fc-gone'), true)
    invalidatePreviewReadyFamilies(['fc-gone'])
    faces[0]!.status = 'loading'
    assert.equal(isPreviewFontReady('fc-gone'), false)
  } finally {
    restore()
  }
})

test('previewFacesFailed only when every matching face errored', () => {
  assert.equal(previewFacesFailed([]), false)
  assert.equal(previewFacesFailed(['error']), true)
  assert.equal(previewFacesFailed(['error', 'loaded']), false)
  assert.equal(previewFacesFailed(['loading']), false)
})

test('an errored variable face does not leave a watch-folder preview loading forever', async () => {
  // @font-face for a variable font is `font-weight: 1 1000` (catalogFontFaceRules).
  // The card waits on the numeric OS/2 weight. A failed file must still clear the spinner.
  const faces = [{ family: 'fc-vf-watch', weight: '1 1000', style: 'normal', status: 'error' }]
  const restore = mockFonts({ check: false, faces })
  try {
    assert.equal(isPreviewFontReady('fc-vf-watch', 400), false)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
      isPreviewFontReady('fc-vf-watch', 400),
      true,
      'variable font-weight range in error must not spin forever',
    )
  } finally {
    restore()
  }
})

test('a FontFace load that never settles does not leave the preview pending', async () => {
  const faces = [{ family: 'fc-hang-watch', weight: 400, style: 'normal', status: 'loading' }]
  const restore = mockFonts({
    check: false,
    faces,
    load: () => new Promise(() => {}),
  })
  try {
    const pending = isPreviewFontReady('fc-hang-watch', 400)
    assert.equal(pending, false)
    let stop = () => {}
    const cleared = await Promise.race([
      new Promise<boolean>((resolve) => {
        stop = subscribePreviewFonts(() => {
          if (isPreviewFontReady('fc-hang-watch', 400)) {
            stop()
            resolve(true)
          }
        })
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
    ])
    stop()
    assert.equal(cleared, true, 'a hung document.fonts.load() must time out into a visible error')
  } finally {
    restore()
  }
})

test('remounting after an empty FontFace load must not keep the spinner latched', async () => {
  let loads = 0
  const faces = [{ family: 'fc-remount-watch', weight: 400, style: 'normal', status: 'unloaded' }]
  const restore = mockFonts({
    check: false,
    faces,
    onLoad: () => {
      loads += 1
    },
  })
  try {
    const stop = subscribePreviewFonts(() => {})
    assert.equal(isPreviewFontReady('fc-remount-watch', 400), false)
    await new Promise((resolve) => setImmediate(resolve))
    stop()
    assert.equal(
      isPreviewFontReady('fc-remount-watch', 400),
      true,
      'an empty load must not stay latched after the card remounts',
    )
    assert.ok(loads >= 1)
  } finally {
    restore()
  }
})

test('one failed weight does not mark another weight as failed', async () => {
  const faces = [{ family: '"fc-mix"', weight: 700, style: 'normal', status: 'error' }]
  const restore = mockFonts({ check: false, faces })
  try {
    assert.equal(isPreviewFontReady('fc-mix', 400), false)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
      isPreviewFontReady('fc-mix', 400),
      false,
      'weight 400 must stay retryable when only 700 errored',
    )
    assert.equal(isPreviewFontReady('fc-mix', 700), false)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(isPreviewFontReady('fc-mix', 700), true)
  } finally {
    restore()
  }
})
