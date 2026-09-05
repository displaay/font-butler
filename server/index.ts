import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs'
import path from 'node:path'
import { contentDisposition } from '../core/auth.ts'
import { onEvent } from '../core/events.ts'
import { FontButlerService } from '../core/service.ts'

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
    const urlPath = decodeURIComponent(new URL(c.req.url).pathname)
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
    const candidate = path.normalize(path.join(root, rel))
    if (!candidate.startsWith(root)) {
      return c.body('Forbidden', 403)
    }
    const target =
      fs.existsSync(candidate) && fs.statSync(candidate).isFile()
        ? candidate
        : path.join(root, 'index.html')
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return c.body('Not found', 404)
    }
    return new Response(fs.readFileSync(target), {
      headers: { 'Content-Type': mimeForStatic(target) },
    })
  })
}

export async function startFontButlerServer(
  options: { staticDir?: string; port?: number } = {},
): Promise<{ port: number }> {
  const PORT = options.port ?? Number(process.env.FONT_BUTLER_API_PORT || process.env.FONTCASE_API_PORT || 43182)
  const service = new FontButlerService()

  await service.init()

const apiToken = service.getApiToken()
const app = new Hono()

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET') {
    return next()
  }
  const auth = c.req.header('Authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (bearer !== apiToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
})

app.get('/api/health', (c) => c.json({ ok: true, platform: process.platform }))

app.get('/api/bootstrap', (c) =>
  c.json({
    token: apiToken,
    settings: service.getSettings(),
    officeFontCache: service.officeFontCacheInfo(),
    adobeFontCache: service.adobeFontCacheInfo(),
  }),
)

app.get('/api/settings', (c) =>
  c.json({
    settings: service.getSettings(),
    officeFontCache: service.officeFontCacheInfo(),
    adobeFontCache: service.adobeFontCacheInfo(),
  }),
)

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
  }>()
  try {
    const settings = await service.updateSettings(body)
    return c.json({
      settings,
      officeFontCache: service.officeFontCacheInfo(),
      adobeFontCache: service.adobeFontCacheInfo(),
    })
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not save settings' },
      400,
    )
  }
})

app.get('/api/catalog', (c) => c.json({ entries: service.listCatalog() }))

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
  }>()
  const options = { replace: body.replace === true }
  try {
    if (body.ids?.length) {
      const entries = await service.installMany(body.ids, body.familyName, options)
      return c.json({ entries })
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

app.post('/api/uninstall', async (c) => {
  const body = await c.req.json<{ id?: string; ids?: string[]; deleteSource?: boolean }>()
  const options = { deleteSource: body.deleteSource === true }
  try {
    if (body.ids?.length) {
      const entries = await service.uninstallMany(body.ids, options)
      return c.json({ entries })
    }
    if (!body.id) {
      return c.json({ error: 'Missing id or ids' }, 400)
    }
    const entry = await service.uninstall(body.id, options)
    return c.json({ entry })
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
  const body = await c.req.json<{ id?: string; ids?: string[]; replace?: boolean }>()
  const options = { replace: body.replace === true }
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

app.post('/api/reinstall', async (c) => {
  const body = await c.req.json<{ id?: string; ids?: string[] }>()
  try {
    if (body.ids?.length) {
      const entries = await service.reinstallMany(body.ids)
      return c.json({ entries })
    }
    if (!body.id) {
      return c.json({ error: 'Missing id or ids' }, 400)
    }
    const entry = await service.reinstall(body.id)
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

app.get('/api/font-file/:id', (c) => {
  try {
    const file = service.fontBytesForEntry(c.req.param('id'))
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

  return new Promise<{ port: number }>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
      console.log(`Font Buttler API on http://127.0.0.1:${info.port}`)
      resolve({ port: info.port })
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
