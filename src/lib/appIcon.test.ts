import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APP_ICON_OPTIONS,
  DEFAULT_APP_ICON_STYLE,
  appIconPreviewSrc,
  isAppIconStyle,
  parseAppIconStyle,
} from './appIcon.ts'

test('parseAppIconStyle keeps classic, bright and mono, otherwise defaults to classic', () => {
  assert.equal(parseAppIconStyle('classic'), 'classic')
  assert.equal(parseAppIconStyle('bright'), 'bright')
  assert.equal(parseAppIconStyle('mono'), 'mono')
  assert.equal(parseAppIconStyle(undefined), DEFAULT_APP_ICON_STYLE)
  assert.equal(parseAppIconStyle('neon'), 'classic')
  assert.equal(isAppIconStyle('mono'), true)
  assert.equal(isAppIconStyle('neon'), false)
})

test('app icon options and preview paths cover all packages', () => {
  assert.deepEqual(
    APP_ICON_OPTIONS.map((option) => option.id),
    ['classic', 'bright', 'mono'],
  )
  assert.equal(APP_ICON_OPTIONS[0]?.label, 'Classic')
  assert.equal(APP_ICON_OPTIONS[1]?.label, 'Bright')
  assert.equal(APP_ICON_OPTIONS[2]?.label, 'Black & grey')
  assert.equal(appIconPreviewSrc('classic'), '/app-icons/classic.png')
  assert.equal(appIconPreviewSrc('bright'), '/app-icons/bright.png')
  assert.equal(appIconPreviewSrc('mono'), '/app-icons/mono.png')
})
