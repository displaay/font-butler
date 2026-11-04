import type { Hono } from 'hono'
import type { DocumentFontReport } from '../core/document-fonts.ts'
import { reportDocumentFonts } from '../core/document-fonts.ts'
import type { CatalogEntry, ProjectSet } from '../core/types.ts'

export function mountDocumentFontsRoute(
  app: Hono,
  listCatalog: () => readonly CatalogEntry[],
  actions?: {
    createProjectFromDocument?: (name: string, report: DocumentFontReport) => Promise<ProjectSet>
  },
): void {
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

  const createProjectFromDocument = actions?.createProjectFromDocument
  if (!createProjectFromDocument) return

  app.post('/api/documents/project', async (c) => {
    let body: { path?: unknown; name?: unknown }
    try {
      body = await c.req.json<{ path?: unknown; name?: unknown }>()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      return c.json({ error: 'Missing path' }, 400)
    }
    try {
      const report = reportDocumentFonts(body.path, listCatalog)
      const name = typeof body.name === 'string' ? body.name : ''
      return c.json({ project: await createProjectFromDocument(name, report) })
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not create a project from this document' },
        400,
      )
    }
  })
}
