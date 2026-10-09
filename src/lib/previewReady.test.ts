import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  invalidatePreviewReadyFamilies,
  isGenericPreviewFamily,
  isPreviewFontFailed,
  isPreviewFontReady,
  normalizePreviewFamily,
  notifyPreviewCssMounted,
  PREVIEW_LOAD_TIMEOUT_MS,
  previewFacesFailed,
  previewRetryGeneration,
  retryPreviewFamily,
  setPreviewLoadTimeoutForTests,
  subscribePreviewFonts,
  subscribePreviewRetries,
  withRetryParam,
} from './previewReady.ts'

type MockFace = { family: string; weight?: number | string; style?: string; status?: string }

function mockFonts(options: {
  check?: boolean | ((spec: string) => boolean)
  faces?: MockFace[]
  onLoad?: () => void
  /** Called only when a registered document.fonts listener actually runs. */
  onFontEvent?: (type: string) => void
  /** Replaces the default load() that resolves empty. */
  load?: (spec: string) => Promise<unknown>
}): () => void {
  const faces = options.faces ?? []
  const fontListeners = new Map<string, Set<() => void>>()
  const fonts = {
    check: (spec: string) =>
      typeof options.check === 'function' ? options.check(spec) : Boolean(options.check),
    load: (spec: string) => {
      options.onLoad?.()
      return options.load ? options.load(spec) : Promise.resolve([])
    },
    addEventListener(type: string, listener: () => void) {
      const wrapped = () => {
        options.onFontEvent?.(type)
        listener()
      }
      const bucket = fontListeners.get(type) ?? new Set<() => void>()
      bucket.add(wrapped)
      fontListeners.set(type, bucket)
    },
    dispatchEvent(event: { type?: string } | string) {
      const type = typeof event === 'string' ? event : event.type
      if (!type) return false
      for (const listener of fontListeners.get(type) ?? []) listener()
      return true
    },
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

test('a settled empty load retries once and then stops instead of retry-storming', async () => {
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
    assert.equal(loads, 2)
    assert.equal(isPreviewFontReady('fc-reload'), true)
    assert.equal(isPreviewFontFailed('fc-reload'), true)
    assert.equal(isPreviewFontReady('fc-reload'), true)
    assert.equal(loads, 2)
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
    assert.equal(loads, 2)
    assert.equal(isPreviewFontFailed('fc-pruned'), true)
    invalidatePreviewReadyFamilies(['fc-pruned'])
    assert.equal(isPreviewFontFailed('fc-pruned'), false)
    assert.equal(isPreviewFontReady('fc-pruned'), false)
    assert.equal(loads, 3)
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
  assert.equal(PREVIEW_LOAD_TIMEOUT_MS, 10000)
  setPreviewLoadTimeoutForTests(20)
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
    assert.equal(isPreviewFontFailed('fc-hang-watch', 400), true)
  } finally {
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
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

test('a loaded face keeps the key from failing when a sibling face at the same weight errored', async () => {
  const faces = [
    { family: 'fc-sibling-face', weight: 400, style: 'normal', status: 'loaded' },
    { family: 'fc-sibling-face', weight: 400, style: 'normal', status: 'error' },
  ]
  const restore = mockFonts({ check: true, faces })
  try {
    assert.equal(isPreviewFontReady('fc-sibling-face', 400), true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
      isPreviewFontFailed('fc-sibling-face', 400),
      false,
      'one errored face does not fail the key while a sibling face has loaded',
    )
    assert.equal(isPreviewFontReady('fc-sibling-face', 400), true)
  } finally {
    restore()
  }
})

test('one failed weight does not mark another weight as failed', async () => {
  const faces = [{ family: '"fc-mix"', weight: 700, style: 'normal', status: 'error' }]
  const restore = mockFonts({ check: false, faces })
  try {
    assert.equal(isPreviewFontReady('fc-mix', 700), false)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(isPreviewFontReady('fc-mix', 700), true)
    assert.equal(isPreviewFontFailed('fc-mix', 700), true)
    assert.equal(
      isPreviewFontFailed('fc-mix', 400),
      false,
      'weight 400 stays unmarked when only 700 errored',
    )
    assert.equal(isPreviewFontFailed('fc-mix-other', 400), false)
    assert.equal(isPreviewFontReady('fc-mix-other', 400), false)
  } finally {
    restore()
  }
})

test('a hung family times out without failing a neighbor, and retry reloads only that family', async () => {
  setPreviewLoadTimeoutForTests(20)
  let loads = 0
  const restore = mockFonts({
    check: (spec) => spec.includes('fc-neighbor'),
    faces: [
      { family: 'fc-hang-family', weight: 400, style: 'normal', status: 'loading' },
      { family: 'fc-neighbor', weight: 400, style: 'normal', status: 'loaded' },
    ],
    load: (spec) => {
      loads += 1
      if (spec.includes('fc-hang-family')) return new Promise(() => {})
      return Promise.resolve([])
    },
  })
  try {
    assert.equal(isPreviewFontReady('fc-neighbor', 400), true)
    assert.equal(isPreviewFontReady('fc-hang-family', 400), false)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(isPreviewFontFailed('fc-hang-family', 400), true)
    assert.equal(isPreviewFontFailed('fc-hang-family', 700), false)
    assert.equal(isPreviewFontReady('fc-neighbor', 400), true)
    assert.equal(isPreviewFontFailed('fc-neighbor', 400), false)
    const loadsBeforeRetry = loads
    retryPreviewFamily('fc-hang-family')
    assert.equal(isPreviewFontFailed('fc-hang-family', 400), false)
    assert.equal(isPreviewFontReady('fc-hang-family', 400), false)
    assert.equal(loads, loadsBeforeRetry + 1)
    assert.equal(isPreviewFontReady('fc-neighbor', 400), true)
    assert.equal(isPreviewFontFailed('fc-neighbor', 400), false)
  } finally {
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
    restore()
  }
})

test('a hanging weight times out on its own after a sibling weight loads', async () => {
  setPreviewLoadTimeoutForTests(30)
  let weight700Ready = false
  const faces = [
    { family: 'fc-pair', weight: 400, style: 'normal', status: 'loading' },
    { family: 'fc-pair', weight: 700, style: 'normal', status: 'loading' },
  ]
  const restore = mockFonts({
    check: (spec) => spec.includes(' 700 ') && weight700Ready,
    faces,
    load: (spec) => {
      if (spec.includes(' 700 ')) {
        return new Promise((resolve) => {
          queueMicrotask(() => {
            faces[1]!.status = 'loaded'
            weight700Ready = true
            resolve([])
          })
        })
      }
      return new Promise(() => {})
    },
  })
  try {
    assert.equal(isPreviewFontReady('fc-pair', 400), false)
    assert.equal(isPreviewFontReady('fc-pair', 700), false)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(isPreviewFontFailed('fc-pair', 700), false)
    assert.equal(isPreviewFontReady('fc-pair', 700), true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(isPreviewFontFailed('fc-pair', 400), true)
    assert.equal(isPreviewFontFailed('fc-pair', 700), false)
    assert.equal(isPreviewFontReady('fc-pair', 700), true)
  } finally {
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
    restore()
  }
})

test('a timed-out preview becomes ready when the face finishes loading', async () => {
  setPreviewLoadTimeoutForTests(20)
  let loaded = false
  const faces = [{ family: 'fc-late', weight: 400, style: 'normal', status: 'loading' }]
  const restore = mockFonts({
    check: () => loaded,
    faces,
    load: () => new Promise(() => {}),
  })
  try {
    let sawReady = false
    const stop = subscribePreviewFonts(() => {
      if (isPreviewFontReady('fc-late', 400) && !isPreviewFontFailed('fc-late', 400)) {
        sawReady = true
      }
    })
    assert.equal(isPreviewFontReady('fc-late', 400), false)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(isPreviewFontFailed('fc-late', 400), true)
    assert.equal(sawReady, false)
    faces[0]!.status = 'loaded'
    loaded = true
    notifyPreviewCssMounted()
    assert.equal(sawReady, true)
    assert.equal(isPreviewFontFailed('fc-late', 400), false)
    assert.equal(isPreviewFontReady('fc-late', 400), true)
    stop()
  } finally {
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
    restore()
  }
})

test('a timed-out key recovers when its load settles while another timed-out key still hangs', async () => {
  setPreviewLoadTimeoutForTests(20)
  let finishA: (() => void) | undefined
  let aLoaded = false
  const faces = [
    { family: 'fc-late-a', weight: 400, style: 'normal', status: 'loading' },
    { family: 'fc-hang-b', weight: 400, style: 'normal', status: 'loading' },
  ]
  let loadingdone = 0
  const restore = mockFonts({
    check: (spec) => spec.includes('fc-late-a') && aLoaded,
    faces,
    onFontEvent: (type) => {
      if (type === 'loadingdone') loadingdone += 1
    },
    load: (spec) => {
      if (spec.includes('fc-late-a')) {
        return new Promise((resolve) => {
          finishA = () => {
            faces[0]!.status = 'loaded'
            aLoaded = true
            resolve([])
          }
        })
      }
      return new Promise(() => {})
    },
  })
  try {
    assert.equal(isPreviewFontReady('fc-late-a', 400), false)
    assert.equal(isPreviewFontReady('fc-hang-b', 400), false)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(isPreviewFontFailed('fc-late-a', 400), true)
    assert.equal(isPreviewFontFailed('fc-hang-b', 400), true)
    const stop = subscribePreviewFonts(() => {
      isPreviewFontReady('fc-late-a', 400)
    })
    assert.ok(finishA)
    finishA()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(loadingdone, 0)
    assert.equal(
      isPreviewFontFailed('fc-late-a', 400),
      false,
      'a late success clears the timeout failure without loadingdone',
    )
    assert.equal(isPreviewFontReady('fc-late-a', 400), true)
    assert.equal(isPreviewFontFailed('fc-hang-b', 400), true)
    stop()
  } finally {
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
    restore()
  }
})

test('retry re-arms the per-key timeout after a failed load', async () => {
  setPreviewLoadTimeoutForTests(20)
  const restore = mockFonts({
    check: false,
    faces: [{ family: 'fc-rearm', weight: 400, style: 'normal', status: 'loading' }],
    load: () => new Promise(() => {}),
  })
  try {
    assert.equal(isPreviewFontReady('fc-rearm', 400), false)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(isPreviewFontFailed('fc-rearm', 400), true)
    retryPreviewFamily('fc-rearm')
    assert.equal(isPreviewFontFailed('fc-rearm', 400), false)
    assert.equal(isPreviewFontReady('fc-rearm', 400), false)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(
      isPreviewFontFailed('fc-rearm', 400),
      true,
      'the timeout starts again after Retry',
    )
  } finally {
    setPreviewLoadTimeoutForTests(PREVIEW_LOAD_TIMEOUT_MS)
    restore()
  }
})

test('withRetryParam appends r without reordering the signed query', () => {
  const signed = '/api/font-file/abc?v=rev&which=source&exp=10&sig=ab'
  assert.equal(withRetryParam(signed, 0), signed)
  assert.equal(withRetryParam(signed, 1), `${signed}&r=1`)
  assert.equal(withRetryParam(`${signed}&r=1`, 2), `${signed}&r=2`)
})

test('retry bumps the cache-busting generation before previews load again', () => {
  const restore = mockFonts({ check: false, faces: [] })
  try {
    const order: string[] = []
    const stopRetry = subscribePreviewRetries(() => {
      order.push('css')
    })
    const stopFonts = subscribePreviewFonts(() => {
      order.push('fonts')
    })
    assert.equal(previewRetryGeneration('fc-bust-order'), 0)
    retryPreviewFamily('fc-bust-order')
    assert.equal(previewRetryGeneration('fc-bust-order'), 1)
    assert.deepEqual(order, ['css', 'fonts'])
    stopRetry()
    stopFonts()
  } finally {
    restore()
  }
})
