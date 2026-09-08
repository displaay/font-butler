import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isGenericPreviewFamily,
  isPreviewFontReady,
  normalizePreviewFamily,
} from './previewReady.ts'

type MockFace = { family: string }

function mockFonts(options: { check?: boolean; faces?: MockFace[] }): () => void {
  const faces = options.faces ?? []
  const fonts = {
    check: () => Boolean(options.check),
    load: async () => [],
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
  const restore = mockFonts({ check: false, faces: [{ family: 'fc-abc' }] })
  try {
    assert.equal(isPreviewFontReady('fc-abc'), false)
  } finally {
    restore()
  }
})
