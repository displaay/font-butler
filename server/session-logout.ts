import type { Hono } from 'hono'

type SessionLogoutService = {
  requestLogout: () => Promise<unknown>
  requestLogoutProbe: () => Promise<unknown>
}

export function mountSessionLogoutRoutes(app: Hono, service: SessionLogoutService): void {
  app.post('/api/session/logout', async (c) => {
    try {
      return c.json(await service.requestLogout())
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not log out' },
        400,
      )
    }
  })

  app.post('/api/session/logout-probe', async (c) => {
    try {
      return c.json(await service.requestLogoutProbe())
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not run the logout probe' },
        400,
      )
    }
  })
}
