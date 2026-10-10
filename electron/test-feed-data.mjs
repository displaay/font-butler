import path from 'node:path'
import { outermostAppBundle, readAppTestFeedMarker } from './app-update-install.mjs'

/** userData directory name for a packaged build stamped fontButlerTestFeed. */
export const TEST_FEED_USER_DATA_DIR = 'Font Buttler Test'

/**
 * Isolate a marked test build from the real library.
 * Unmarked builds return isolate: false and must not change paths or env.
 * `FONT_BUTLER_DATA` is filled in only when it is unset, so an explicit
 * override still wins. The data folder then sits inside the test userData.
 */
export function planTestFeedDataIsolation({ testFeedBuild = false, appData = '', env = {} } = {}) {
  if (testFeedBuild !== true) {
    return { isolate: false, userData: null, dataDir: null, setDataEnv: false }
  }
  const userData = path.join(appData, TEST_FEED_USER_DATA_DIR)
  const existing = env.FONT_BUTLER_DATA
  const unset = existing == null || String(existing).trim() === ''
  const dataDir = unset ? path.join(userData, 'data') : String(existing)
  return { isolate: true, userData, dataDir, setDataEnv: unset }
}

/** Point main.log at Font Buttler Test when this process is the marked test build. */
export function rememberTestFeedLogName(plan, env = process.env) {
  if (plan?.isolate === true) env.FONT_BUTLER_LOG_NAME = TEST_FEED_USER_DATA_DIR
}

/**
 * Apply the plan to a real Electron `app` before the single-instance lock.
 * The marker is read from the running bundle, so a LaunchServices relaunch
 * with an empty environment still isolates.
 */
export function applyTestFeedDataIsolation(app, env = process.env, execPath = process.execPath) {
  const appPath = outermostAppBundle(execPath)
  // Only an explicit true marker isolates. null (unreadable) and false stay
  // on the real library. runInstall is what refuses a null download.
  const testFeedBuild = readAppTestFeedMarker(appPath) === true
  const plan = planTestFeedDataIsolation({
    testFeedBuild,
    appData: app.getPath('appData'),
    env,
  })
  if (!plan.isolate) return plan
  if (typeof app.isReady === 'function' && app.isReady()) {
    throw new Error('A marked test build must set userData before the app is ready.')
  }
  app.setPath('userData', plan.userData)
  if (plan.setDataEnv) env.FONT_BUTLER_DATA = plan.dataDir
  rememberTestFeedLogName(plan, env)
  return plan
}
