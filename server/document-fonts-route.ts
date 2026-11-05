import type { Hono } from 'hono'
import type { DocumentFontReport } from '../core/document-fonts.ts'
import { reportDocumentFonts, reportNamedDocumentFonts } from '../core/document-fonts.ts'
import type { CatalogEntry, ProjectSet } from '../core/types.ts'

export function mountDocumentFontsRoute(
  app: Hono,
  listCatalog: () => readonly CatalogEntry[],
  actions?: {
    createProjectFromDocument?: (name: string, report: DocumentFontReport) => Promise<ProjectSet>
  },
): void {
  app.post('/api/documents/fonts', async (c) => {
    let body: { path?: unknown; fonts?: unknown }
    try {
      body = await c.req.json<{ path?: unknown; fonts?: unknown }>()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const named = namedDocumentFonts(body.fonts)
    if (named) {
      return c.json(reportNamedDocumentFonts(named, listCatalog))
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
    let body: { path?: unknown; name?: unknown; fonts?: unknown }
    try {
      body = await c.req.json<{ path?: unknown; name?: unknown; fonts?: unknown }>()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const named = namedDocumentFonts(body.fonts)
    if (!named && (typeof body.path !== 'string' || body.path.trim() === '')) {
      return c.json({ error: 'Missing path' }, 400)
    }
    try {
      const report = named
        ? reportNamedDocumentFonts(named, listCatalog)
        : reportDocumentFonts(body.path as string, listCatalog)
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

function namedDocumentFonts(
  value: unknown,
): { postscriptName: string; familyName: string; styleName: string }[] | null {
  if (!Array.isArray(value)) return null
  const fonts: { postscriptName: string; familyName: string; styleName: string }[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    fonts.push({
      postscriptName: typeof record.postscriptName === 'string' ? record.postscriptName : '',
      familyName: typeof record.familyName === 'string' ? record.familyName : '',
      styleName: typeof record.styleName === 'string' ? record.styleName : '',
    })
    if (fonts.length >= 4000) break
  }
  return fonts
}
