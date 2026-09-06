import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canCompareInstalledVsSource,
  capturedFontFamily,
  isComparisonSourceStale,
} from './comparison.ts'
import type { CatalogEntry, ComparisonCapture } from './types.ts'

function entry(partial: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'face',
    sourcePath: '/tmp/Source.ttf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    sourceAvailability: 'present',
    status: 'installed',
    installedPath: '/tmp/installed/Source.ttf',
    faces: [],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('canCompareInstalledVsSource requires a distinct present source', () => {
  assert.equal(canCompareInstalledVsSource(entry()), true)
  assert.equal(canCompareInstalledVsSource(entry({ sourceAvailability: 'missing' })), false)
  assert.equal(
    canCompareInstalledVsSource(entry({ sourcePath: '/tmp/installed/Source.ttf' })),
    false,
  )
  assert.equal(canCompareInstalledVsSource(entry({ installedPath: undefined })), false)
})

test('isComparisonSourceStale is true only when live source fingerprint drifts from capture', () => {
  const capture: ComparisonCapture = {
    id: 'face',
    installedFingerprint: 'aa',
    sourceFingerprint: 'old-source',
  }
  assert.equal(isComparisonSourceStale(capture, 'old-source'), false)
  assert.equal(isComparisonSourceStale(capture, 'new-source'), true)
  assert.equal(isComparisonSourceStale(capture, undefined), false)
  assert.equal(isComparisonSourceStale(null, 'new-source'), false)
})

test('capturedFontFamily is distinct per side so preview CSS cannot alias live faces', () => {
  assert.equal(capturedFontFamily('face', 'installed'), 'fc-face-captured-installed')
  assert.equal(capturedFontFamily('face', 'source'), 'fc-face-captured-source')
  assert.notEqual(capturedFontFamily('face', 'installed'), capturedFontFamily('face', 'source'))
})
