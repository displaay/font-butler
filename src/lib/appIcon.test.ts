import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APP_ICON_OPTIONS,
  DEFAULT_APP_ICON_STYLE,
  appIconPreviewSrc,
  isAppIconStyle,
  parseAppIconStyle,
} from './appIcon.ts'

test('parseAppIconStyle keeps bright and mono, otherwise defaults to bright', () => {
  assert.equal(parseAppIconStyle('bright'), 'bright')
  assert.equal(parseAppIconStyle('mono'), 'mono')
  assert.equal(parseAppIconStyle(undefined), DEFAULT_APP_ICON_STYLE)
  assert.equal(parseAppIconStyle('neon'), 'bright')
  assert.equal(isAppIconStyle('mono'), true)
  assert.equal(isAppIconStyle('neon'), false)
})

test('app icon options and preview paths cover both packages', () => {
  assert.deepEqual(
    APP_ICON_OPTIONS.map((option) => option.id),
    ['bright', 'mono'],
  )
  assert.equal(APP_ICON_OPTIONS[0]?.label, 'Bright')
  assert.equal(APP_ICON_OPTIONS[1]?.label, 'Black & grey')
  assert.equal(appIconPreviewSrc('bright'), '/app-icons/bright.png')
  assert.equal(appIconPreviewSrc('mono'), '/app-icons/mono.png')
})
