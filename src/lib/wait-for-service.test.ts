import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForServiceReady } from './api.ts'

test('waitForServiceReady rejects when health reports init failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: false,
        ready: false,
        catalogReady: true,
        phase: 'failed',
        error: 'CatalogCorruptError: invalid JSON',
      }),
      { status: 200 },
    )) as typeof fetch
  try {
    await assert.rejects(
      () => waitForServiceReady({ pollMs: 1 }),
      /CatalogCorruptError|could not start/i,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
