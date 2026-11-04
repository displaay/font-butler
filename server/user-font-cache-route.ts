import type { Hono } from 'hono'

type UserFontCacheService = {
  clearUserFontCache: (options: { confirm: true }) => Promise<unknown>
  clearAllFontCaches: (options: { confirm: true }) => Promise<unknown>
}

const CONFIRM_ERROR =
  'Clearing font caches needs confirmation. Some apps may not see new or updated fonts until you log out.'

async function confirmedBody(c: {
  req: { json: <T>() => Promise<T> }
}): Promise<{ confirm?: boolean }> {
  try {
    return await c.req.json<{ confirm?: boolean }>()
  } catch {
    return {}
  }
}

export function mountUserFontCacheRoute(app: Hono, service: UserFontCacheService): void {
  app.post('/api/caches/font', async (c) => {
    const body = await confirmedBody(c)
    if (body.confirm !== true) {
      return c.json({ error: CONFIRM_ERROR }, 400)
    }
    try {
      const result = await service.clearUserFontCache({ confirm: true })
      return c.json(result)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not remove font cache' },
        400,
      )
    }
  })

  // Combined maintenance clear. Declining (no `confirm: true`) runs
  // nothing — not even the Office/Adobe parts.
  app.post('/api/caches/all', async (c) => {
    const body = await confirmedBody(c)
    if (body.confirm !== true) {
      return c.json({ error: CONFIRM_ERROR }, 400)
    }
    try {
      const result = await service.clearAllFontCaches({ confirm: true })
      return c.json(result)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not clear font caches' },
        400,
      )
    }
  })
}
