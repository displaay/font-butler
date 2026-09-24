/**
 * Packaged-app bootstrap helpers (pure + small state helpers for tests).
 */

export const BOOTSTRAP_ERROR_WINDOW_KIND = 'bootstrap-error'
export const BOOTSTRAP_STARTING_WINDOW_KIND = 'bootstrap-starting'

export function shouldIgnoreShowMainWindowDuringBootstrap({ isPackaged, bootstrapping, apiBootstrapReady }) {
  return isPackaged && bootstrapping && !apiBootstrapReady
}

export function shouldRetryBootstrapOnActivate({ isPackaged, apiBootstrapReady, bootstrapping, lastBootstrapError }) {
  return isPackaged && !bootstrapping && !apiBootstrapReady && Boolean(lastBootstrapError)
}

export function canRetryPackagedBootstrap({ isPackaged, bootstrapping, hasBootstrapRunner }) {
  return Boolean(isPackaged && hasBootstrapRunner && !bootstrapping)
}

/** Remove handlers that would quit or stale-reference a window being replaced. */
export function detachWindowLifecycleHandlers(win) {
  if (!win || win.isDestroyed?.()) return
  win.removeAllListeners('close')
  win.removeAllListeners('closed')
}

export function canOpenMainUi({ isPackaged, apiBootstrapReady }) {
  return !isPackaged || apiBootstrapReady
}

export function classifyWorkerFailure(error, stderrTail = '') {
  const message = error instanceof Error ? error.message : String(error)
  const timedOut = /did not start/i.test(message)
  const exited = /exited/i.test(message)
  const corrupt = /CatalogCorruptError|service init failed|invalid JSON|corrupt/i.test(stderrTail)
  if (corrupt) return 'init-failed'
  if (timedOut) return 'listen-timeout'
  if (exited) return 'worker-exit'
  return 'other'
}

export function formatBootstrapFailureMessage(error, options = {}) {
  const {
    stderrTail = '',
    catalogPath = '',
    dataDir = '',
    docsUrl = 'https://github.com/displaay/font-butler/blob/main/docs/troubleshooting-blank-window.md',
  } = options
  const reason = error instanceof Error ? error.message : String(error)
  const kind = classifyWorkerFailure(error, stderrTail)
  const lines = [
    'Font Buttler could not start its local font service.',
    '',
    reason,
  ]
  if (stderrTail.trim()) {
    lines.push('', 'Recent service output:', stderrTail.trim().slice(-1200))
  }
  lines.push('')
  if (kind === 'listen-timeout') {
    lines.push(
      'The service did not begin listening in time. With a very large library, startup can take several minutes while fonts are indexed.',
      'Quit Font Buttler completely, wait a moment, and open it again. Check Console.app (filter "Font Buttler") for "init complete".',
    )
  } else if (kind === 'init-failed') {
    lines.push(
      'The service exited while loading your library. Do not delete catalog.json alone — that can discard your backup.',
      'To recover: quit the app, copy catalog.json.bak over catalog.json if the backup looks good, or move the whole data folder aside and relaunch.',
    )
  } else {
    lines.push(
      'Quit Font Buttler completely (Font Buttler → Quit) and open it again.',
      'If it keeps failing, open Console.app, filter for "Font Buttler", and save the startup log.',
    )
  }
  if (dataDir) {
    lines.push('', `Data folder:\n${dataDir}`)
  } else if (catalogPath) {
    lines.push('', `Library catalog:\n${catalogPath}`)
  }
  lines.push('', `More help: ${docsUrl}`)
  return lines.join('\n')
}

export function bootstrapErrorPageHtml(message, { dark = false } = {}) {
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const bg = dark ? '#0a0a0a' : '#ffffff'
  const fg = dark ? '#f4f4f5' : '#111111'
  const panel = dark ? '#18181b' : '#f4f4f5'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<title>Font Buttler</title>
<style>
  body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; color: ${fg}; background: ${bg}; }
  h1 { font-size: 16px; margin: 0 0 12px; }
  pre { white-space: pre-wrap; background: ${panel}; padding: 12px; border-radius: 8px; font-size: 12px; color: ${fg}; }
  .actions { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
  button { padding: 8px 14px; font-size: 13px; cursor: pointer; }
</style>
</head>
<body>
  <h1>Font Buttler could not start</h1>
  <pre>${safe}</pre>
  <div class="actions">
    <button type="button" id="logs">Show logs</button>
    <button type="button" id="quit">Quit Font Buttler</button>
  </div>
  <script>
    document.getElementById('logs').addEventListener('click', () => {
      if (window.fontButlerDesktop?.showDebugLogs) window.fontButlerDesktop.showDebugLogs();
    });
    document.getElementById('quit').addEventListener('click', () => {
      if (window.fontButlerDesktop?.quitApp) window.fontButlerDesktop.quitApp();
      else window.close();
    });
  </script>
</body>
</html>`
}

export function startingPageHtml({ dark = false } = {}) {
  const bg = dark ? '#0a0a0a' : '#ffffff'
  const fg = dark ? '#f4f4f5' : '#111111'
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>Font Buttler</title>
<style>body{font:14px -apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:${fg};background:${bg};}</style>
</head><body><p>Starting Font Buttler…</p></body></html>`
}

/** @param {{ mainWindowKind: string | null }} state @param {'bootstrap-ok' | 'bootstrap-fail' | 'activate-during-bootstrap'} event */
export function reduceBootstrapWindowState(state, event) {
  const next = { ...state }
  if (event === 'activate-during-bootstrap') {
    if (next.mainWindowKind === null) next.mainWindowKind = BOOTSTRAP_STARTING_WINDOW_KIND
    return next
  }
  if (event === 'bootstrap-fail') {
    next.mainWindowKind = BOOTSTRAP_ERROR_WINDOW_KIND
    return next
  }
  if (event === 'bootstrap-ok') {
    if (next.mainWindowKind === BOOTSTRAP_ERROR_WINDOW_KIND || next.mainWindowKind === BOOTSTRAP_STARTING_WINDOW_KIND) {
      next.mainWindowKind = 'replace-with-main'
    }
    return next
  }
  return next
}
