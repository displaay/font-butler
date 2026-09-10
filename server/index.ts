import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs'
import path from 'node:path'
import { contentDisposition, shouldIncludeBootstrapToken } from '../core/auth.ts'
import { onEvent } from '../core/events.ts'
import { isFullyUnderAnyRoot } from '../core/containment.ts'
import { denyRemoteRequest, isAuthorizedApiRequest, resolveStaticAsset } from '../core/http.ts'
import { checkAppUpdate } from '../core/app-update.ts'
import { FontButlerService } from '../core/service.ts'
import type { AppSettings } from '../core/types.ts'

function mimeForStatic(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}

function mountStatic(app: Hono, staticDir: string): void {
  const root = path.resolve(staticDir)
  app.get('*', async (c) => {
    const urlPath = new URL(c.req.url).pathname
    const resolved = resolveStaticAsset(root, urlPath)
    if (resolved === 'forbidden') {
      return c.body('Forbidden', 403)
    }
    const fallback = path.join(root, 'index.html')
    const candidate = resolved
    const target =
      candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
        ? candidate
        : fallback
    if (!isFullyUnderAnyRoot(target, [root]) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return c.body('Not found', 404)
    }
    return new Response(fs.readFileSync(target), {
      headers: { 'Content-Type': mimeForStatic(target) },
    })
  })
}

export async function startFontButlerServer(
  options: { staticDir?: string; port?: number } = {},
): Promise<{ port: number; token: string }> {
  const PORT = options.port ?? Number(process.env.FONT_BUTLER_API_PORT || process.env.FONTCASE_API_PORT || 43182)
  const extraOrigins = [process.env.FONT_BUTLER_UI, process.env.FONTCASE_UI].filter(
    (value): value is string => Boolean(value),
  )
  const service = new FontButlerService()

  await service.init()

const apiToken = service.getApiToken()
const app = new Hono()

app.use('*', async (c, next) => {
  const denied = denyRemoteRequest(c, PORT, extraOrigins)
  if (denied) return denied
  return next()
})

app.use('/api/*', async (c, next) => {
  if (
    isAuthorizedApiRequest({
      method: c.req.method,
      pathname: c.req.path,
      authorization: c.req.header('Authorization'),
      token: apiToken,
      query: {
        exp: c.req.query('exp'),
        sig: c.req.query('sig'),
        which: c.req.query('which'),
        revision: c.req.query('revision'),
        path: c.req.query('path'),
      },
    })
  ) {
    return next()
  }
  return c.json({ error: 'Unauthorized' }, 401)
})

app.get('/api/health', (c) => c.json({ ok: true, platform: process.platform }))

app.get('/api/app-update', async (c) => {
  const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true'
  const update = await checkAppUpdate({ refresh })
  return c.json({ update })
})

app.get('/api/bootstrap', (c) => {
  const payload = {
    settings: service.getSettings(),
    officeFontCache: service.officeFontCacheInfo(),
    adobeFontCache: service.adobeFontCacheInfo(),
    destinations: service.listDestinations(),
    ...(shouldIncludeBootstrapToken() ? { token: apiToken } : {}),
  }
  return c.json(payload)
})

app.get('/api/settings', (c) =>
  c.json({
    settings: service.getSettings(),
    officeFontCache: service.officeFontCacheInfo(),
    adobeFontCache: service.adobeFontCacheInfo(),
    destinations: service.listDestinations(),
  }),
)

app.get('/api/destinations', (c) => c.json(service.listDestinations()))

app.post('/api/destinations/adobe', (c) => {
  try {
    return c.json(service.createAdobeTestingFolder())
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not create the Adobe testing folder' },
      400,
    )
  }
})

app.post('/api/settings', async (c) => {
  const body = await c.req.json<{
    watchFolders?: string[]
    defaultView?: 'list' | 'grid'
    defaultSort?: 'name' | 'added' | 'installed'
    installAfterUpload?: boolean
    installWatchFolderFonts?: boolean
    theme?: 'light' | 'dark' | 'system'
    menuBarIcon?: boolean
    openAtLogin?: boolean
    clearOfficeFontCache?: boolean
    clearAdobeFontCache?: boolean
    autoReinstallOnUpdate?: boolean
    skipCacheClearOnReinstall?: boolean
    nativeNotifications?: boolean
    onboardingCompleted?: boolean
    revisionBudgetBytes?: number
    activityRetentionDays?: number
    activityMaxOperations?: number
    folders?: AppSettings['folders']
    specimen?: AppSettings['specimen']
    latinPreview?: AppSettings['latinPreview']
    defaultDestination?: AppSettings['defaultDestination']
    savedFilters?: AppSettings['savedFilters']
  }>()
  try {
    const settings = await service.updateSettings(body)
    return c.json({
      settings,
      officeFontCache: service.officeFontCacheInfo(),
      adobeFontCache: service.adobeFontCacheInfo(),
      destinations: service.listDestinations(),
    })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not save settings' },
      400,
    )
  }
})

app.get('/api/catalog', (c) => c.json({ entries: service.listCatalog() }))

app.get('/api/duplicates', (c) => c.json({ duplicates: service.listDuplicates() }))

app.post('/api/duplicates/resolve', async (c) => {
  const body = await c.req.json<{
    id?: string
    choice?: 'replace' | 'add-inactive' | 'skip' | 'switch' | 'install-as'
    familyName?: string
  }>()
  if (!body.id || !body.choice) {
    return c.json({ error: 'Missing id or choice' }, 400)
  }
  try {
    return c.json(await service.resolveDuplicate(body.id, body.choice, { familyName: body.familyName }))
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not resolve that duplicate' },
      400,
    )
  }
})

app.post('/api/switch', async (c) => {
  const body = await c.req.json<{ id?: string }>()
  if (!body.id) {
    return c.json({ error: 'Missing id' }, 400)
  }
  try {
    return c.json({ entry: await service.switchTo(body.id) })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Switch failed' },
      400,
    )
  }
})

app.get('/api/system', (c) => c.json({ faces: service.listSystem() }))

app.post('/api/drop-inspect', async (c) => {
  const body = await c.req.json<{ paths?: string[] }>()
  return c.json(service.inspectDrop(body.paths ?? []))
})

app.post('/api/import', async (c) => {
  const body = await c.req.json<{ paths?: string[] }>()
  const result = await service.importPaths(body.paths ?? [])
  return c.json(result)
})

app.post('/api/import-files', async (c) => {
  const body = await c.req.parseBody({ all: true })
  const raw = body.files
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (item): item is File => item instanceof File,
  )
  const uploads = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      data: Buffer.from(await file.arrayBuffer()),
    })),
  )
  const result = await service.importUploads(uploads)
  return c.json(result)
})

app.post('/api/open', async (c) => {
  const body = await c.req.json<{ path: string }>()
  if (!body.path) {
    return c.json({ error: 'Missing path' }, 400)
  }
  try {
    const entry = await service.openWith(body.path)
    return c.json({ entry })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not open font' },
      400,
    )
  }
})

app.post('/api/install', async (c) => {
  const body = await c.req.json<{
    id?: string
    ids?: string[]
    familyName?: string
    replace?: boolean
    destinationId?: 'macos' | 'adobe-shared'
    destinationIds?: Array<'macos' | 'adobe-shared'>
    expectedSourceFingerprint?: string
  }>()
  const options = {
    replace: body.replace === true,
    destinationId: body.destinationId,
    destinationIds: body.destinationIds,
    expectedSourceFingerprint: body.expectedSourceFingerprint,
  }
  try {
    if (body.ids?.length) {
      const entries = await service.installMany(body.ids, body.familyName, options)
      const batch = entries as typeof entries & Partial<import('../core/types.ts').BatchActionResult>
      return c.json({
        entries,
        operationId: batch.operationId,
        succeeded: batch.succeeded,
        failed: batch.failed,
        skipped: batch.skipped,
        canceled: batch.canceled,
        errors: batch.errors,
        failedIds: batch.failedIds,
      })
    }
    if (!body.id) {
      return c.json({ error: 'Missing id or ids' }, 400)
    }
    const entry = await service.install(body.id, body.familyName, options)
    return c.json({ entry })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Install failed' },
      400,
    )
  }
})

app.post('/api/install/destination-remove', async (c) => {
  const body = await c.req.json<{ id?: string; destinationId?: 'macos' | 'adobe-shared' }>()
  if (!body.id || !body.destinationId) {
    return c.json({ error: 'Missing id or destination' }, 400)
  }
  try {
    return c.json({ entry: await service.removeDestinationCopy(body.id, body.destinationId) })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not remove that copy' },
      400,
    )
  }
})

app.post('/api/uninstall', async (c) => {
  const body = await c.req.json<{ id?: string; ids?: string[]; deleteSource?: boolean }>()
  const options = { deleteSource: body.deleteSource === true }
  try {
    if (body.ids?.length) {
      const entries = await service.uninstallMany(body.ids, options)
      const operation = service.listActivity()[0]
      return c.json({
        entries,
        operationId: operation?.action === 'uninstall' ? operation.id : undefined,
        undoable: operation?.action === 'uninstall' && operation.undoable && !operation.undone,
      })
    }
    if (!body.id) {
      return c.json({ error: 'Missing id or ids' }, 400)
    }
    const entry = await service.uninstall(body.id, options)
    const operation = service.listActivity()[0]
    return c.json({
      entry,
      operationId: operation?.action === 'uninstall' ? operation.id : undefined,
      undoable: operation?.action === 'uninstall' && operation.undoable && !operation.undone,
    })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Uninstall failed' },
      400,
    )
  }
})

app.post('/api/deactivate', async (c) => {
  const body = await c.req.json<{ id?: string; ids?: string[] }>()
  try {
    if (body.ids?.length) {
      const entries = await service.deactivateMany(body.ids)
      return c.json({ entries })
    }
    if (!body.id) {
      return c.json({ error: 'Missing id or ids' }, 400)
    }
    const entry = await service.deactivate(body.id)
    return c.json({ entry })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Deactivate failed' },
      400,
    )
  }
})

app.post('/api/activate', async (c) => {
  const body = await c.req.json<{
    id?: string
    ids?: string[]
    replace?: boolean
    switch?: boolean
    destinationIds?: Array<'macos' | 'adobe-shared'>
  }>()
  const options = {
    replace: body.replace === true,
    switch: body.switch === true,
    destinationIds: body.destinationIds,
  }
  try {
    if (body.ids?.length) {
      const entries = await service.activateMany(body.ids, options)
      return c.json({ entries })
    }
    if (!body.id) {
      return c.json({ error: 'Missing id or ids' }, 400)
    }
    const entry = await service.activate(body.id, options)
    return c.json({ entry })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Activate failed' },
      400,
    )
  }
})

app.post('/api/bake-features', async (c) => {
  const body = await c.req.json<{
    id?: string
    features?: string[]
    mode?: 'reinstall' | 'new-copy'
    familyName?: string
  }>()
  if (!body.id) {
    return c.json({ error: 'Missing id' }, 400)
  }
  if (body.mode !== 'reinstall' && body.mode !== 'new-copy') {
    return c.json({ error: 'Missing bake mode' }, 400)
  }
  try {
    const result = await service.bakeFeatures(body.id, body.features ?? [], body.mode, body.familyName)
    return c.json(result)
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Bake failed' },
      400,
    )
  }
})

app.post('/api/reinstall', async (c) => {
  const body = await c.req.json<{
    id?: string
    ids?: string[]
    expectedSourceFingerprint?: string
  }>()
  const options = { expectedSourceFingerprint: body.expectedSourceFingerprint }
  try {
    if (body.ids?.length) {
      const entries = await service.reinstallMany(body.ids, options)
      const batch = entries as typeof entries & Partial<import('../core/types.ts').BatchActionResult>
      return c.json({
        entries,
        operationId: batch.operationId,
        succeeded: batch.succeeded,
        failed: batch.failed,
        skipped: batch.skipped,
        canceled: batch.canceled,
        errors: batch.errors,
        failedIds: batch.failedIds,
      })
    }
    if (!body.id) {
      return c.json({ error: 'Missing id or ids' }, 400)
    }
    const entry = await service.reinstall(body.id, options)
    return c.json({ entry })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Reinstall failed' },
      400,
    )
  }
})

app.post('/api/forget', async (c) => {
  const body = await c.req.json<{
    id?: string
    ids?: string[]
    allMissing?: boolean
    deleteFiles?: boolean
  }>()
  const options = { deleteFiles: Boolean(body.deleteFiles) }
  try {
    if (body.allMissing) {
      const result = await service.forgetMissingSources()
      return c.json(result)
    }
    if (body.ids?.length) {
      const result = await service.forgetMany(body.ids, options)
      return c.json(result)
    }
    if (!body.id) {
      return c.json({ error: 'Missing id, ids, or allMissing' }, 400)
    }
    await service.forget(body.id, options)
    return c.json({ removed: 1 })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not remove font' },
      400,
    )
  }
})

app.post('/api/system/uninstall', async (c) => {
  const body = await c.req.json<{ path: string }>()
  try {
    await service.uninstallSystem(body.path)
    return c.json({ ok: true })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Uninstall failed' },
      400,
    )
  }
})

app.post('/api/system/deactivate', async (c) => {
  const body = await c.req.json<{ path: string }>()
  try {
    await service.deactivateSystem(body.path)
    return c.json({ ok: true })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Deactivate failed' },
      400,
    )
  }
})

app.post('/api/caches/font', async (c) => {
  try {
    const result = await service.clearUserFontCache()
    return c.json(result)
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not remove font cache' },
      400,
    )
  }
})

app.post('/api/caches/office', async (c) => {
  try {
    const result = await service.clearOfficeFontCache()
    return c.json(result)
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not remove Microsoft Office cache' },
      400,
    )
  }
})

app.post('/api/caches/adobe', async (c) => {
  try {
    const result = await service.clearAdobeFontCache()
    return c.json(result)
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not remove Adobe font cache' },
      400,
    )
  }
})

app.post('/api/reveal', async (c) => {
  const body = await c.req.json<{ id?: string; path?: string; which?: 'source' | 'installed' }>()
  try {
    const revealed = body.id
      ? await service.reveal(body.id, body.which ?? 'source')
      : await service.revealPath(body.path ?? '')
    return c.json({ path: revealed })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not show file' },
      400,
    )
  }
})

app.get('/api/rename-preview', (c) => {
  const id = c.req.query('id') ?? ''
  const familyName = c.req.query('familyName') ?? ''
  return c.json(service.namePreview(id, familyName))
})

function fail(error: unknown, fallback: string) {
  return { error: error instanceof Error ? error.message : fallback }
}

app.post('/api/relink/inspect', async (c) => {
  const body = await c.req.json<{ id: string; path: string }>()
  try {
    return c.json(service.inspectRelink(body.id, body.path))
  } catch (error) {
    return c.json(fail(error, 'Could not inspect source'), 400)
  }
})

app.post('/api/relink', async (c) => {
  const body = await c.req.json<{ id: string; path: string }>()
  try {
    return c.json({ entry: await service.applyRelink(body.id, body.path) })
  } catch (error) {
    return c.json(fail(error, 'Could not link source'), 400)
  }
})

app.post('/api/relink/folder/inspect', async (c) => {
  const body = await c.req.json<{ oldRoot: string; newRoot: string; search?: boolean }>()
  try {
    return c.json(service.inspectFolderRelink(body.oldRoot, body.newRoot, body.search !== false))
  } catch (error) {
    return c.json(fail(error, 'Could not inspect folder'), 400)
  }
})

app.post('/api/relink/folder', async (c) => {
  const body = await c.req.json<{
    oldRoot: string
    newRoot: string
    selections?: Record<string, string | undefined>
  }>()
  try {
    return c.json({
      entries: await service.applyFolderRelink(body.oldRoot, body.newRoot, body.selections),
    })
  } catch (error) {
    return c.json(fail(error, 'Could not relink folder'), 400)
  }
})

app.post('/api/folders/configure', async (c) => {
  const body = await c.req.json<{
    root: string
    policy?: 'library' | 'install-new' | 'install-new-and-updates' | 'custom'
    installNew?: boolean
    autoUpdate?: boolean
    exclusions?: string[]
    id?: string
    destinationId?: 'macos' | 'adobe-shared' | 'macos-and-adobe'
  }>()
  try {
    return c.json(await service.configureFolder(body))
  } catch (error) {
    return c.json(fail(error, 'Could not configure folder'), 400)
  }
})

app.post('/api/folders/start', async (c) => {
  const body = await c.req.json<{ id: string }>()
  try {
    return c.json({ folder: await service.startWatching(body.id) })
  } catch (error) {
    return c.json(fail(error, 'Could not start watching'), 400)
  }
})

app.post('/api/folders/pause', async (c) => {
  const body = await c.req.json<{ id: string }>()
  try {
    return c.json({ folder: await service.pauseFolder(body.id) })
  } catch (error) {
    return c.json(fail(error, 'Could not pause folder'), 400)
  }
})

app.post('/api/folders/resume', async (c) => {
  const body = await c.req.json<{ id: string }>()
  try {
    return c.json({ folder: await service.resumeFolder(body.id) })
  } catch (error) {
    return c.json(fail(error, 'Could not resume folder'), 400)
  }
})

app.post('/api/import/plan', async (c) => {
  const body = await c.req.json<{ paths?: string[] }>()
  return c.json(service.planImport(body.paths ?? []))
})

app.post('/api/import/apply', async (c) => {
  const body = await c.req.json<{
    planId: string
    choices?: Record<string, 'keep' | 'replace' | 'install-as' | 'skip' | 'relink' | 'add-inactive' | 'switch'>
    idempotencyKey?: string
    familyName?: string
  }>()
  try {
    return c.json(await service.applyPlan(body.planId, body.choices, body))
  } catch (error) {
    return c.json(fail(error, 'Could not apply import'), 400)
  }
})

app.get('/api/retail/status', (c) => c.json({ status: service.retailStatus() }))

app.post('/api/retail/configure', async (c) => {
  const body = await c.req.json<{
    enabled?: boolean
    workerBaseUrl?: string
    token?: string
    folderId?: string | null
  }>()
  try {
    // The token goes in on this route and never comes back out: status reports `hasToken` only.
    return c.json({ status: service.configureRetailSync(body) })
  } catch (error) {
    return c.json(fail(error, 'Could not save the retail collection settings'), 400)
  }
})

app.post('/api/retail/check', async (c) => {
  const body = await c.req.json<{ refresh?: boolean }>().catch(() => ({}) as { refresh?: boolean })
  try {
    return c.json({ status: await service.checkRetail({ refresh: body.refresh }) })
  } catch (error) {
    return c.json(fail(error, 'Could not check the retail collection'), 400)
  }
})

app.post('/api/retail/sync', async (c) => {
  try {
    return c.json({ status: await service.syncRetail() })
  } catch (error) {
    return c.json(fail(error, 'Could not sync the retail collection'), 400)
  }
})

app.get('/api/activity', (c) => c.json({ operations: service.listActivity() }))

app.post('/api/activity/read', async (c) => {
  try {
    return c.json({ operations: service.markAllActivityRead() })
  } catch (error) {
    return c.json(fail(error, 'Could not mark activity as read'), 400)
  }
})

app.post('/api/activity/unread', async (c) => {
  const body = await c.req.json<{ ids?: string[] }>()
  try {
    return c.json({ operations: service.markActivityUnread(body.ids ?? []) })
  } catch (error) {
    return c.json(fail(error, 'Could not mark activity as unread'), 400)
  }
})

app.post('/api/activity/clear', async (c) => {
  try {
    return c.json({ operations: service.clearActivity() })
  } catch (error) {
    return c.json(fail(error, 'Could not clear activity'), 400)
  }
})

app.post('/api/activity/undo', async (c) => {
  const body = await c.req.json<{ id: string }>()
  try {
    return c.json(await service.undoOperation(body.id))
  } catch (error) {
    return c.json(fail(error, 'Could not undo'), 400)
  }
})

app.get('/api/revisions/:id', (c) => {
  try {
    return c.json({ revisions: service.listRevisions(c.req.param('id')) })
  } catch (error) {
    return c.json(fail(error, 'Could not list versions'), 400)
  }
})

app.post('/api/revisions/restore', async (c) => {
  const body = await c.req.json<{ id: string; fingerprint?: string }>()
  try {
    return c.json({ entry: await service.restoreRevision(body.id, body.fingerprint) })
  } catch (error) {
    return c.json(fail(error, 'Could not restore version'), 400)
  }
})

app.post('/api/updates/resume', async (c) => {
  const body = await c.req.json<{ id: string }>()
  try {
    return c.json({ entry: await service.resumeUpdates(body.id) })
  } catch (error) {
    return c.json(fail(error, 'Could not resume updates'), 400)
  }
})

app.post('/api/repair', async (c) => {
  const body = await c.req.json<{ ids?: string[]; caches?: boolean }>()
  try {
    return c.json(await service.repair(body.ids ?? [], { caches: body.caches === true }))
  } catch (error) {
    return c.json(fail(error, 'Repair failed'), 400)
  }
})

app.get('/api/projects', (c) => c.json({ projects: service.listProjects() }))

app.post('/api/projects', async (c) => {
  const body = await c.req.json<{ name?: string; memberIds?: string[] }>()
  return c.json({ project: await service.createProject(body.name ?? 'Untitled project', body.memberIds) })
})

app.post('/api/projects/update', async (c) => {
  const body = await c.req.json<{
    id: string
    name?: string
    memberIds?: string[]
    pin?: { assetId: string; fingerprint?: string }
  }>()
  try {
    return c.json({ project: await service.updateProject(body.id, body) })
  } catch (error) {
    return c.json(fail(error, 'Could not update project'), 400)
  }
})

app.post('/api/projects/delete', async (c) => {
  const body = await c.req.json<{ id: string }>()
  await service.deleteProject(body.id)
  return c.json({ ok: true })
})

app.post('/api/projects/activate', async (c) => {
  const body = await c.req.json<{ id: string }>()
  try {
    return c.json(await service.activateProject(body.id))
  } catch (error) {
    return c.json(fail(error, 'Could not activate project'), 400)
  }
})

app.post('/api/projects/deactivate', async (c) => {
  const body = await c.req.json<{ id: string }>()
  try {
    await service.deactivateProject(body.id)
    return c.json({ ok: true })
  } catch (error) {
    return c.json(fail(error, 'Could not deactivate project'), 400)
  }
})

app.post('/api/comparison/capture', async (c) => {
  const body = await c.req.json<{ id?: string }>()
  if (!body.id) {
    return c.json({ error: 'Missing id' }, 400)
  }
  try {
    return c.json(await service.captureComparison(body.id))
  } catch (error) {
    return c.json(fail(error, 'Could not capture comparison'), 400)
  }
})

app.get('/api/preview-meta/:id', (c) => {
  try {
    const which = (c.req.query('which') ?? 'installed') as 'source' | 'installed' | 'revision'
    return c.json(service.previewMeta(c.req.param('id'), which, c.req.query('revision') ?? undefined))
  } catch (error) {
    return c.json(fail(error, 'Could not read preview'), 400)
  }
})

app.get('/api/preview-glyph/:id', (c) => {
  try {
    const which = (c.req.query('which') ?? 'installed') as 'source' | 'installed' | 'revision'
    const code = Number(c.req.query('code'))
    if (!Number.isInteger(code)) {
      return c.json({ error: 'Missing code' }, 400)
    }
    return c.json(
      service.previewGlyph(c.req.param('id'), code, which, c.req.query('revision') ?? undefined),
    )
  } catch (error) {
    return c.json(fail(error, 'Could not read glyph'), 400)
  }
})

app.get('/api/font-file/:id', (c) => {
  try {
    const which = (c.req.query('which') ?? 'installed') as 'source' | 'installed' | 'revision'
    const file = service.fontBytesForRevision(c.req.param('id'), which, c.req.query('revision') ?? undefined)
    return new Response(file.buffer, {
      headers: {
        'Content-Type': file.mime,
        'Cache-Control': 'no-cache',
        'Content-Disposition': contentDisposition(file.filename),
      },
    })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Missing font' },
      404,
    )
  }
})

app.get('/api/system-font', (c) => {
  const filePath = c.req.query('path')
  if (!filePath) {
    return c.json({ error: 'Missing path' }, 400)
  }
  try {
    const file = service.fontBytesForPath(filePath)
    return new Response(file.buffer, {
      headers: {
        'Content-Type': file.mime,
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': contentDisposition(file.filename),
      },
    })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Missing font' },
      404,
    )
  }
})

app.get('/api/events', (c) => {
  return streamSSE(c, async (stream) => {
    let closed = false
    const unsubscribe = onEvent(async (event) => {
      if (closed) {
        return
      }
      await stream.writeSSE({ data: JSON.stringify(event) })
    })
    stream.onAbort(() => {
      closed = true
      unsubscribe()
    })
    await stream.writeSSE({
      data: JSON.stringify({ type: 'catalog', entries: service.listCatalog() }),
    })
    while (!closed) {
      await stream.sleep(15_000)
      if (!closed) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'ping' }) })
      }
    }
  })
})

  if (options.staticDir) {
    mountStatic(app, options.staticDir)
  }

  return new Promise<{ port: number; token: string }>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
      console.log(`Font Buttler API on http://127.0.0.1:${info.port}`)
      resolve({ port: info.port, token: apiToken })
    })
    server.once('error', reject)
  })
}

const invokedAsCli = process.argv[1]
  ? path.normalize(process.argv[1]).includes(`${path.sep}server${path.sep}index`)
  : false
if (invokedAsCli) {
  await startFontButlerServer()
}
