import type { Hono } from 'hono'

type UserFontCacheService = {
  clearUserFontCache: (options: { confirm: true }) => Promise<unknown>
}

export function mountUserFontCacheRoute(app: Hono, service: UserFontCacheService): void {
  app.post('/api/caches/font', async (c) => {
    let body: { confirm?: boolean } = {}
    try {
      body = await c.req.json<{ confirm?: boolean }>()
    } catch {
      body = {}
    }
    if (body.confirm !== true) {
      return c.json(
        {
          error:
            'Clearing font caches needs confirmation. Some apps may not see new or updated fonts until you log out.',
        },
        400,
      )
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
}
