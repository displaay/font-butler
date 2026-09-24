import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BOOTSTRAP_ERROR_WINDOW_KIND,
  BOOTSTRAP_STARTING_WINDOW_KIND,
  classifyWorkerFailure,
  formatBootstrapFailureMessage,
  reduceBootstrapWindowState,
  shouldIgnoreShowMainWindowDuringBootstrap,
  shouldRetryBootstrapOnActivate,
  canRetryPackagedBootstrap,
  detachWindowLifecycleHandlers,
} from './bootstrap-window.mjs'

test('Dock activate during bootstrap shows starting, not a sticky error window', () => {
  assert.equal(
    shouldIgnoreShowMainWindowDuringBootstrap({
      isPackaged: true,
      bootstrapping: true,
      apiBootstrapReady: false,
    }),
    true,
  )
  const next = reduceBootstrapWindowState({ mainWindowKind: null }, 'activate-during-bootstrap')
  assert.equal(next.mainWindowKind, BOOTSTRAP_STARTING_WINDOW_KIND)
})

test('successful bootstrap replaces a bootstrap shell window', () => {
  const next = reduceBootstrapWindowState(
    { mainWindowKind: BOOTSTRAP_ERROR_WINDOW_KIND },
    'bootstrap-ok',
  )
  assert.equal(next.mainWindowKind, 'replace-with-main')
})

test('activate after failure offers retry path', () => {
  assert.equal(
    shouldRetryBootstrapOnActivate({
      isPackaged: true,
      apiBootstrapReady: false,
      bootstrapping: false,
      lastBootstrapError: new Error('exited'),
    }),
    true,
  )
})

test('formatBootstrapFailureMessage warns against renaming catalog alone', () => {
  const message = formatBootstrapFailureMessage(new Error('exited (1)'), {
    stderrTail: 'CatalogCorruptError: bad json',
    dataDir: '/tmp/Font Buttler',
  })
  assert.match(message, /Do not delete catalog\.json alone|copy catalog\.json\.bak/i)
  assert.doesNotMatch(message, /rename catalog\.json/i)
})

test('retry is blocked while bootstrapping', () => {
  assert.equal(
    canRetryPackagedBootstrap({ isPackaged: true, bootstrapping: true, hasBootstrapRunner: true }),
    false,
  )
  assert.equal(
    canRetryPackagedBootstrap({ isPackaged: true, bootstrapping: false, hasBootstrapRunner: true }),
    true,
  )
})

test('detachWindowLifecycleHandlers removes close and closed listeners', () => {
  const listeners = { close: 0, closed: 0 }
  const win = {
    isDestroyed: () => false,
    removeAllListeners(event) {
      if (event === 'close') listeners.close += 1
      if (event === 'closed') listeners.closed += 1
    },
  }
  detachWindowLifecycleHandlers(win)
  assert.equal(listeners.close, 1)
  assert.equal(listeners.closed, 1)
})

test('classifyWorkerFailure separates timeout from init failure', () => {
  assert.equal(classifyWorkerFailure(new Error('did not start'), ''), 'listen-timeout')
  assert.equal(
    classifyWorkerFailure(new Error('exited (1)'), 'Font Buttler service init failed'),
    'init-failed',
  )
})
