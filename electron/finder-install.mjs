export const FINDER_PROTOCOL = 'font-butler'
export const FINDER_INSTALL = 'install'
export const FINDER_INSTALL_AS = 'install-as'
export const FINDER_LINK_TO = 'link-to'
export const FINDER_INSTALL_FLAG = '--finder-install'
export const FINDER_INSTALL_AS_FLAG = '--finder-install-as'
export const FINDER_LINK_TO_FLAG = '--finder-link-to'
export const FINDER_ACTIONS = [FINDER_INSTALL, FINDER_INSTALL_AS, FINDER_LINK_TO]

export const INSTALLABLE_FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc']
export const CLAIMED_FONT_EXTENSIONS = [...INSTALLABLE_FONT_EXTENSIONS, 'woff', 'woff2']

/** UTIs Finder already treats as fonts, plus `public.font` for collections and oddballs. */
export const FONT_SERVICE_UTIS = [
  'public.font',
  'public.opentype-font',
  'public.truetype-ttf-font',
  'public.truetype-collection-font',
]

export const FINDER_SERVICE_PORT_NAME = 'Font Buttler'
export const FINDER_INSTALL_MESSAGE = 'installFonts'
export const FINDER_INSTALL_AS_MESSAGE = 'installFontsAs'
export const FINDER_LINK_TO_MESSAGE = 'linkFonts'

const INSTALLABLE_FONT_RE = /\.(ttf|otf|ttc|otc)$/i
const CLAIMED_FONT_RE = /\.(ttf|otf|ttc|otc|woff2?)$/i
const ELECTRON_ARG_RE = /^(?:-[-a-zA-Z].*|--inspect(?:-brk)?(?:=.*)?|--remote-debugging-port=.*)$/

export function isFinderInstallAction(value) {
  return value === FINDER_INSTALL || value === FINDER_INSTALL_AS
}

export function isFinderLinkToAction(value) {
  return value === FINDER_LINK_TO
}

export function isFinderAction(value) {
  return isFinderInstallAction(value) || isFinderLinkToAction(value)
}

export function isInstallableFontPath(filePath) {
  return typeof filePath === 'string' && INSTALLABLE_FONT_RE.test(filePath)
}

export function isClaimedFontPath(filePath) {
  return typeof filePath === 'string' && CLAIMED_FONT_RE.test(filePath)
}

export function finderServiceMenuTitle(action) {
  if (action === FINDER_INSTALL_AS) return 'Install as…'
  if (action === FINDER_LINK_TO) return 'Link to …'
  return 'Install'
}

export function finderServiceMessage(action) {
  if (action === FINDER_INSTALL_AS) return FINDER_INSTALL_AS_MESSAGE
  if (action === FINDER_LINK_TO) return FINDER_LINK_TO_MESSAGE
  return FINDER_INSTALL_MESSAGE
}

export function finderServicesPlist(options = {}) {
  const portName = options.portName ?? FINDER_SERVICE_PORT_NAME
  const sendFileTypes = options.sendFileTypes ?? FONT_SERVICE_UTIS
  return FINDER_ACTIONS.map((action) => ({
    NSMenuItem: { default: finderServiceMenuTitle(action) },
    NSMessage: finderServiceMessage(action),
    NSPortName: portName,
    NSUserData: action,
    NSRequiredContext: { NSTextContent: 'FilePath' },
    NSSendFileTypes: [...sendFileTypes],
  }))
}

export function finderUrlSchemePlist() {
  return [
    {
      CFBundleURLName: 'Font Buttler Finder Install',
      CFBundleURLSchemes: [FINDER_PROTOCOL],
    },
  ]
}

function decodeMaybeUri(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const trimmed = value.trim()
  try {
    if (/^file:/i.test(trimmed)) {
      return decodeURIComponent(new URL(trimmed).pathname)
    }
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function splitPathPayload(value) {
  if (!value) return []
  return String(value)
    .split(/\r?\n|\|/g)
    .map((item) => decodeMaybeUri(item))
    .filter(Boolean)
}

export function parseFinderInstallUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== `${FINDER_PROTOCOL}:`) return null
  const host = parsed.hostname.replace(/^\/+/, '')
  const parts = [host, ...parsed.pathname.split('/').filter(Boolean)].filter(Boolean)
  if (parts[0] !== 'finder') return null
  const action = parts[1]
  if (!isFinderAction(action)) return null
  const paths = []
  for (const [key, value] of parsed.searchParams) {
    if (key === 'p' || key === 'path' || key === 'file') {
      const filePath = decodeMaybeUri(value)
      if (filePath) paths.push(filePath)
    } else if (key === 'files' || key === 'paths') {
      paths.push(...splitPathPayload(value))
    }
  }
  if (parsed.hash.length > 1) {
    paths.push(...splitPathPayload(parsed.hash.slice(1)))
  }
  return { action, paths: uniquePaths(paths) }
}

export function finderInstallUrl(action, filePaths) {
  if (!isFinderAction(action)) {
    throw new Error('Unknown Finder install action')
  }
  const url = new URL(`${FINDER_PROTOCOL}://finder/${action}`)
  for (const filePath of uniquePaths(filePaths)) {
    url.searchParams.append('p', filePath)
  }
  return url.toString()
}

function uniquePaths(filePaths) {
  const seen = new Set()
  const out = []
  for (const filePath of filePaths ?? []) {
    if (typeof filePath !== 'string') continue
    const trimmed = filePath.trim()
    if (!trimmed || trimmed.startsWith('-')) continue
    const key = trimmed
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function isLikelyLaunchArg(arg) {
  if (typeof arg !== 'string' || !arg) return true
  if (arg === '.' || arg === 'electron' || arg.endsWith('/electron')) return true
  if (ELECTRON_ARG_RE.test(arg)) return true
  if (arg.endsWith('.mjs') || arg.endsWith('.js') || arg.endsWith('.cjs')) return true
  return false
}

export function parseFinderLaunch(argv) {
  const args = Array.isArray(argv) ? argv : []
  let action = null
  const paths = []
  for (const arg of args) {
    if (arg === FINDER_INSTALL_FLAG) {
      action = FINDER_INSTALL
      continue
    }
    if (arg === FINDER_INSTALL_AS_FLAG) {
      action = FINDER_INSTALL_AS
      continue
    }
    if (arg === FINDER_LINK_TO_FLAG) {
      action = FINDER_LINK_TO
      continue
    }
    if (typeof arg === 'string' && arg.startsWith(`${FINDER_PROTOCOL}:`)) {
      const fromUrl = parseFinderInstallUrl(arg)
      if (fromUrl) {
        action = fromUrl.action
        paths.push(...fromUrl.paths)
      }
      continue
    }
    if (isLikelyLaunchArg(arg)) continue
    if (isClaimedFontPath(arg) || (typeof arg === 'string' && arg.startsWith('/') && !arg.startsWith('-'))) {
      if (action) paths.push(arg)
    }
  }
  if (!action) return null
  return { action, paths: uniquePaths(paths) }
}

export function collectFinderFontPaths(filePaths, options = {}) {
  const existsSync = options.existsSync
  const statSync = options.statSync
  const includeWeb = options.includeWeb === true
  const allowDirectories = options.allowDirectories !== false
  const collected = []
  const skippedWeb = []
  const missing = []

  for (const filePath of filePaths ?? []) {
    if (typeof filePath !== 'string' || !filePath.trim()) continue
    const resolved = filePath.trim()
    if (existsSync && !existsSync(resolved)) {
      missing.push(resolved)
      continue
    }
    if (statSync) {
      try {
        const stat = statSync(resolved)
        if (stat?.isDirectory?.()) {
          if (allowDirectories) collected.push(resolved)
          continue
        }
      } catch {
        missing.push(resolved)
        continue
      }
    }
    if (/\.(woff2?)$/i.test(resolved)) {
      if (includeWeb) collected.push(resolved)
      else skippedWeb.push(resolved)
      continue
    }
    if (isInstallableFontPath(resolved) || (includeWeb && isClaimedFontPath(resolved))) {
      collected.push(resolved)
    }
  }

  return {
    paths: uniquePaths(collected),
    skippedWeb: uniquePaths(skippedWeb),
    missing: uniquePaths(missing),
  }
}

export function destinationChoices(destinations = []) {
  const adobe = destinations.find((item) => item.id === 'adobe-shared')
  const adobeOk = adobe ? adobe.supported !== false : false
  const choices = [{ id: 'macos', label: 'This Mac', destinationIds: ['macos'] }]
  if (adobeOk) {
    choices.push(
      { id: 'adobe-shared', label: 'Adobe folder', destinationIds: ['adobe-shared'] },
      { id: 'macos-and-adobe', label: 'This Mac and Adobe folder', destinationIds: ['macos', 'adobe-shared'] },
    )
  }
  return choices
}

export function familyNamePromptScript(defaultName) {
  const escaped = String(defaultName ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
  return [
    'try',
    '  tell application "System Events" to activate',
    `  set theResult to display dialog "Font Buttler writes a copy with this family name and installs it. The original file stays unchanged." with title "Install as…" default answer "${escaped}" buttons {"Cancel", "Install renamed copy"} default button "Install renamed copy"`,
    '  return text returned of theResult',
    'on error',
    '  return ""',
    'end try',
  ].join('\n')
}

export function idsEligibleForFinderInstall(entries) {
  return (entries ?? [])
    .filter((entry) => entry && !entry.previewOnly)
    .filter((entry) => {
      const status = entry.status
      return status === 'uninstalled' || status === 'deactivated' || status === 'outdated'
    })
    .map((entry) => entry.id)
    .filter(Boolean)
}

export function suggestedFamilyName(entries) {
  const entry = (entries ?? []).find(Boolean)
  if (!entry) return ''
  return entry.customFamilyName || entry.faces?.[0]?.familyName || ''
}

export function groupIdsByFormat(entries) {
  const groups = new Map()
  for (const entry of entries ?? []) {
    if (!entry?.id) continue
    const format = String(entry.format || '').trim().toLowerCase().replace(/^\./, '')
    const key = format || 'font'
    const list = groups.get(key) ?? []
    list.push(entry.id)
    groups.set(key, list)
  }
  return [...groups.values()]
}

function basename(filePath) {
  const parts = String(filePath ?? '').split(/[\\/]/)
  return parts[parts.length - 1] || String(filePath ?? '')
}

export function finderInstallIssues({ errors = [], skippedWeb = [], missing = [] } = {}) {
  const issues = []
  const seen = new Set()
  function add(text) {
    const value = String(text ?? '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    issues.push(value)
  }
  for (const error of errors ?? []) add(error)
  for (const filePath of missing ?? []) add(`${filePath}: file not found.`)
  if ((skippedWeb ?? []).length) {
    const names = uniquePaths(skippedWeb).map((filePath) => basename(filePath)).filter(Boolean)
    add(names.length ? `WOFF files cannot be installed. (${names.join(', ')})` : 'WOFF files cannot be installed.')
  }
  return issues
}

export function formatFinderInstallIssues(issues, { installed = 0 } = {}) {
  const list = (issues ?? []).map((item) => String(item).trim()).filter(Boolean)
  if (!list.length) return ''
  const intro =
    installed > 0
      ? installed === 1
        ? 'Installed 1 font. Some files were skipped:'
        : `Installed ${installed} fonts. Some files were skipped:`
      : 'Some files could not be installed:'
  return [intro, ...list].join('\n')
}

function finderJobKey(job) {
  return `${job?.action ?? ''}\0${(job?.paths ?? []).join('\0')}`
}

export function createFinderJobQueue(runJob) {
  const queued = []
  let canRun = false
  let running = false
  let activeKey = null
  let chain = Promise.resolve()

  function drain() {
    if (!canRun) return chain
    chain = chain.then(async () => {
      if (running) return
      running = true
      try {
        while (queued.length) {
          const job = queued.shift()
          activeKey = finderJobKey(job)
          try {
            await runJob(job.action, job.paths)
          } catch (error) {
            console.error('Finder job failed', error)
          } finally {
            activeKey = null
          }
        }
      } finally {
        running = false
      }
    })
    return chain
  }

  return {
    enqueue(action, filePaths) {
      const job = { action, paths: Array.isArray(filePaths) ? filePaths : [] }
      const key = finderJobKey(job)
      if (activeKey === key || queued.some((item) => finderJobKey(item) === key)) return chain
      queued.push(job)
      return drain()
    },
    start() {
      canRun = true
      return drain()
    },
  }
}
