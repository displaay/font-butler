import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EXTERNAL_FONT_OPEN_LOADING,
  externalFontOpenFinished,
  externalFontOpenLoadingMessage,
  externalFontOpenStarted,
  shouldShowSingleActionProgress,
} from './external-font-open.ts'

test('external font open depth tracks nested starts and finishes', () => {
  let state = { depth: 0 }
  state = externalFontOpenStarted(state)
  state = externalFontOpenStarted(state)
  assert.equal(state.depth, 2)
  state = externalFontOpenFinished(state)
  assert.equal(state.depth, 1)
  state = externalFontOpenFinished(state)
  assert.equal(state.depth, 0)
  state = externalFontOpenFinished(state)
  assert.equal(state.depth, 0)
})

test('loading message is shown only while depth is positive', () => {
  assert.equal(externalFontOpenLoadingMessage({ depth: 0 }), null)
  assert.equal(externalFontOpenLoadingMessage({ depth: 1 }), EXTERNAL_FONT_OPEN_LOADING)
})

test('single-item install progress shows during an external open', () => {
  assert.equal(shouldShowSingleActionProgress(1, 0), false)
  assert.equal(shouldShowSingleActionProgress(1, 1), true)
  assert.equal(shouldShowSingleActionProgress(3, 0), true)
})
