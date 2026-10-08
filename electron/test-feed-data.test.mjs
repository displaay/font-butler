import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { detectAppUpdateRuntime, readAppTestFeedMarker } from './app-update-install.mjs'
import { applyTestFeedDataIsolation, planTestFeedDataIsolation, TEST_FEED_USER_DATA_DIR } from './test-feed-data.mjs'

function fakeApp(appData, { ready = false } = {}) {
  const paths = { appData, userData: path.join(appData, 'Font Buttler') }
  const setPathCalls = []
  return {
    paths,
    setPathCalls,
    isReady() {
      return ready
    },
    getPath(name) {
      return paths[name]
    },
    setPath(name, value) {
      setPathCalls.push([name, value])
      paths[name] = value
      return undefined
    },
  }
}

function writeBundle(root, pkg) {
  const appPath = path.join(root, 'Font Buttler.app')
  const execPath = path.join(appPath, 'Contents', 'MacOS', 'Font Buttler')
  mkdirSync(path.dirname(execPath), { recursive: true })
  mkdirSync(path.join(appPath, 'Contents', 'Resources', 'app'), { recursive: true })
  writeFileSync(execPath, '')
  writeFileSync(
    path.join(appPath, 'Contents', 'Resources', 'app', 'package.json'),
    JSON.stringify(pkg),
  )
  return execPath
}

test('a marked build isolates userData and sets FONT_BUTLER_DATA when it is unset', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-'))
  try {
    const execPath = writeBundle(root, { name: 'font-butler', fontButlerTestFeed: true })
    const appData = path.join(root, 'Application Support')
    const app = fakeApp(appData)
    const env = {}
    const plan = applyTestFeedDataIsolation(app, env, execPath)
    const userData = path.join(appData, TEST_FEED_USER_DATA_DIR)
    assert.equal(plan.isolate, true)
    assert.equal(plan.setDataEnv, true)
    assert.equal(app.paths.userData, userData)
    assert.equal(env.FONT_BUTLER_DATA, path.join(userData, 'data'))
    assert.equal(plan.dataDir, env.FONT_BUTLER_DATA)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a marked build keeps an explicit FONT_BUTLER_DATA and still moves userData', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-'))
  try {
    const execPath = writeBundle(root, { fontButlerTestFeed: true })
    const appData = path.join(root, 'Application Support')
    const app = fakeApp(appData)
    const env = { FONT_BUTLER_DATA: path.join(root, 'custom-data') }
    const plan = applyTestFeedDataIsolation(app, env, execPath)
    assert.equal(plan.isolate, true)
    assert.equal(plan.setDataEnv, false)
    assert.equal(app.paths.userData, path.join(appData, TEST_FEED_USER_DATA_DIR))
    assert.equal(env.FONT_BUTLER_DATA, path.join(root, 'custom-data'))
    assert.equal(plan.dataDir, env.FONT_BUTLER_DATA)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unmarked build does not change userData or FONT_BUTLER_DATA', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-'))
  try {
    const execPath = writeBundle(root, { name: 'font-butler', version: '0.3.9' })
    const appData = path.join(root, 'Application Support')
    const app = fakeApp(appData)
    const originalUserData = app.paths.userData
    const env = { OTHER: 'kept' }
    const plan = applyTestFeedDataIsolation(app, env, execPath)
    assert.equal(plan.isolate, false)
    assert.equal(plan.userData, null)
    assert.equal(plan.dataDir, null)
    assert.equal(app.paths.userData, originalUserData)
    assert.equal(app.setPathCalls.length, 0)
    assert.equal(env.FONT_BUTLER_DATA, undefined)
    assert.equal(env.OTHER, 'kept')
    assert.deepEqual(
      planTestFeedDataIsolation({ testFeedBuild: false, appData, env: { FONT_BUTLER_DATA: '/tmp/real' } }),
      { isolate: false, userData: null, dataDir: null, setDataEnv: false },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unreadable running-app marker stays unmarked and does not isolate', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-null-'))
  try {
    const appPath = path.join(root, 'Font Buttler.app')
    const execPath = path.join(appPath, 'Contents', 'MacOS', 'Font Buttler')
    mkdirSync(path.dirname(execPath), { recursive: true })
    mkdirSync(path.join(appPath, 'Contents', 'Resources'), { recursive: true })
    writeFileSync(execPath, '')
    writeFileSync(path.join(appPath, 'Contents', 'Resources', 'app.asar'), 'not-an-asar')
    assert.equal(readAppTestFeedMarker(appPath), null)

    const runtime = detectAppUpdateRuntime(execPath, () => ({ status: 1, stdout: '', stderr: '' }))
    assert.equal(runtime.packaged, true)
    assert.equal(runtime.testFeedBuild, false)

    const appData = path.join(root, 'Application Support')
    const app = fakeApp(appData)
    const originalUserData = app.paths.userData
    const env = {}
    const plan = applyTestFeedDataIsolation(app, env, execPath)
    assert.equal(plan.isolate, false)
    assert.equal(plan.userData, null)
    assert.equal(plan.dataDir, null)
    assert.equal(plan.setDataEnv, false)
    assert.equal(app.paths.userData, originalUserData)
    assert.equal(app.setPathCalls.length, 0)
    assert.equal(env.FONT_BUTLER_DATA, undefined)
    assert.equal(originalUserData.endsWith(TEST_FEED_USER_DATA_DIR), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('no environment variable can turn isolation on, and only the marker can', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-'))
  try {
    const unmarked = writeBundle(path.join(root, 'plain'), { name: 'font-butler', version: '0.3.9' })
    const marked = writeBundle(path.join(root, 'marked'), { name: 'font-butler', fontButlerTestFeed: true })
    const tempting = {
      FONT_BUTLER_TEST_FEED_BUILD: '1',
      FONT_BUTLER_UPDATE_FEED_URL: 'http://127.0.0.1:8765/',
      FONT_BUTLER_TEST_FEED: '1',
      fontButlerTestFeed: 'true',
    }
    const plainApp = fakeApp(path.join(root, 'Application Support'))
    const plain = applyTestFeedDataIsolation(plainApp, tempting, unmarked)
    assert.equal(plain.isolate, false)
    assert.equal(plainApp.setPathCalls.length, 0)
    assert.equal(tempting.FONT_BUTLER_DATA, undefined)

    const off = {
      FONT_BUTLER_TEST_FEED_BUILD: '0',
      FONT_BUTLER_UPDATE_FEED_URL: '',
      FONT_BUTLER_TEST_FEED: '0',
    }
    const markedApp = fakeApp(path.join(root, 'Application Support'))
    const turnedOn = applyTestFeedDataIsolation(markedApp, off, marked)
    assert.equal(turnedOn.isolate, true)
    assert.deepEqual(markedApp.setPathCalls, [['userData', path.join(root, 'Application Support', TEST_FEED_USER_DATA_DIR)]])
    assert.equal(off.FONT_BUTLER_DATA, path.join(root, 'Application Support', TEST_FEED_USER_DATA_DIR, 'data'))

    const late = fakeApp(path.join(root, 'Application Support'), { ready: true })
    assert.throws(
      () => applyTestFeedDataIsolation(late, {}, marked),
      /before the app is ready/,
    )
    assert.equal(late.setPathCalls.length, 0)
    const helper = readFileSync(new URL('./test-feed-data.mjs', import.meta.url), 'utf8')
    assert.doesNotMatch(helper, /FONT_BUTLER_TEST_FEED_BUILD|FONT_BUTLER_UPDATE_FEED_URL|FONT_BUTLER_TEST_FEED\b/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('main sets test-feed userData and FONT_BUTLER_DATA before the single-instance lock and app ready', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const applyAt = main.indexOf('applyTestFeedDataIsolation(app)')
  const lockAt = main.indexOf('app.requestSingleInstanceLock()')
  const readyAt = main.indexOf('app.whenReady()')
  assert.ok(applyAt > 0)
  assert.ok(applyAt < lockAt)
  assert.ok(applyAt < readyAt)
  assert.doesNotMatch(main.slice(readyAt), /setPath\('userData'|applyTestFeedDataIsolation/)
  const helper = readFileSync(new URL('./test-feed-data.mjs', import.meta.url), 'utf8')
  assert.match(helper, /app\.setPath\('userData', plan\.userData\)/)
  assert.match(helper, /env\.FONT_BUTLER_DATA = plan\.dataDir/)
  assert.match(main, /FONT_BUTLER_DATA: process\.env\.FONT_BUTLER_DATA/)
})
