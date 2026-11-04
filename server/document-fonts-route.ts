import type { Hono } from 'hono'
import { reportDocumentFonts } from '../core/document-fonts.ts'
import type { CatalogEntry } from '../core/types.ts'

export function mountDocumentFontsRoute(app: Hono, listCatalog: () => readonly CatalogEntry[]): void {
  app.post('/api/documents/fonts', async (c) => {
    let body: { path?: unknown }
    try {
      body = await c.req.json<{ path?: unknown }>()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      return c.json({ error: 'Missing path' }, 400)
    }
    try {
      return c.json(reportDocumentFonts(body.path, listCatalog))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not read document fonts' },
        400,
      )
    }
  })
}
