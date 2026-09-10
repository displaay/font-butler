import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitPreviewScale, fitPreviewTransform } from './fitPreview.ts'

test('fitPreviewScale keeps glyphs that already fit', () => {
  assert.equal(fitPreviewScale(40, 40, 100, 100), 1)
})

test('fitPreviewScale shrinks glyphs that overflow the box', () => {
  assert.equal(fitPreviewScale(200, 50, 100, 100, 0), 0.5)
  assert.equal(fitPreviewScale(50, 200, 100, 100, 0), 0.5)
})

test('fitPreviewScale reserves padding so ink does not touch the clip edge', () => {
  assert.equal(fitPreviewScale(100, 100, 100, 100, 0.1), 0.8)
})

test('fitPreviewScale ignores empty measurements', () => {
  assert.equal(fitPreviewScale(0, 40, 100, 100), 1)
  assert.equal(fitPreviewScale(40, 40, 0, 100), 1)
})

test('fitPreviewTransform centers overflowing ink in the box', () => {
  const fit = fitPreviewTransform(
    { left: 0, top: 0, width: 200, height: 80 },
    { left: 0, top: 0, width: 100, height: 100 },
    { left: 0, top: 0 },
    0,
  )
  assert.equal(fit.scale, 0.5)
  assert.equal(fit.translateX, -50)
  assert.equal(fit.translateY, 10)
  assert.equal(fit.originX, 100)
  assert.equal(fit.originY, 40)
})
