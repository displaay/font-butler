import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ErrorBoundary } from './ErrorBoundary'

test('ErrorBoundary exposes getDerivedStateFromError', () => {
  const state = ErrorBoundary.getDerivedStateFromError(new Error('boom'))
  assert.equal(state.error?.message, 'boom')
})
