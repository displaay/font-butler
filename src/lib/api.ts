import type { CatalogEntry, Notice, SystemFace } from './types'

let apiToken: string | null = null

async function ensureToken(): Promise<string> {
  if (apiToken) {
    return apiToken
  }
  const response = await fetch('/api/bootstrap')
  const data = (await response.json()) as { token?: string }
  if (!response.ok || !data.token) {
    throw new Error('Could not connect to Fontcase API.')
  }
  apiToken = data.token
  return apiToken
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra)
  if (apiToken) {
    headers.set('Authorization', `Bearer ${apiToken}`)
  }
  return headers
}

async function json<T>(input: Promise<Response>): Promise<T> {
  await ensureToken()
  const response = await input
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || response.statusText)
  }
  return data
}

async function post(url: string, body: unknown): Promise<Response> {
  await ensureToken()
  return fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
}

export const api = {
  bootstrap: () => ensureToken(),
  catalog: () => json<{ entries: CatalogEntry[] }>(fetch('/api/catalog')),
  system: () => json<{ faces: SystemFace[] }>(fetch('/api/system')),
  importPaths: (paths: string[]) =>
    json<{ entries: CatalogEntry[]; errors: string[] }>(post('/api/import', { paths })),
  importFiles: async (files: File[]) => {
    await ensureToken()
    const body = new FormData()
    for (const file of files) body.append('files', file)
    return json<{ entries: CatalogEntry[]; errors: string[] }>(
      fetch('/api/import-files', { method: 'POST', headers: authHeaders(), body }),
    )
  },
  open: (path: string) => json<{ entry: CatalogEntry }>(post('/api/open', { path })),
  install: (id: string, familyName?: string) =>
    json<{ entry: CatalogEntry }>(post('/api/install', { id, familyName })),
  installMany: (ids: string[], familyName?: string) =>
    json<{ entries: CatalogEntry[] }>(post('/api/install', { ids, familyName })),
  uninstall: (id: string) => json<{ entry: CatalogEntry }>(post('/api/uninstall', { id })),
  uninstallMany: (ids: string[]) =>
    json<{ entries: CatalogEntry[] }>(post('/api/uninstall', { ids })),
  deactivate: (id: string) => json<{ entry: CatalogEntry }>(post('/api/deactivate', { id })),
  deactivateMany: (ids: string[]) =>
    json<{ entries: CatalogEntry[] }>(post('/api/deactivate', { ids })),
  activate: (id: string) => json<{ entry: CatalogEntry }>(post('/api/activate', { id })),
  activateMany: (ids: string[]) =>
    json<{ entries: CatalogEntry[] }>(post('/api/activate', { ids })),
  reinstall: (id: string) => json<{ entry: CatalogEntry }>(post('/api/reinstall', { id })),
  reinstallMany: (ids: string[]) =>
    json<{ entries: CatalogEntry[] }>(post('/api/reinstall', { ids })),
  uninstallSystem: (path: string) => json<{ ok: boolean }>(post('/api/system/uninstall', { path })),
  deactivateSystem: (path: string) =>
    json<{ ok: boolean }>(post('/api/system/deactivate', { path })),
  reveal: (payload: { id?: string; path?: string; which?: 'source' | 'installed' }) =>
    json<{ path: string }>(post('/api/reveal', payload)),
  renamePreview: (id: string, familyName: string) =>
    json<{ fullName: string; postscriptName: string }>(
      fetch(
        `/api/rename-preview?id=${encodeURIComponent(id)}&familyName=${encodeURIComponent(familyName)}`,
      ),
    ),
}

export function subscribeEvents(onEvent: (event: unknown) => void): () => void {
  const source = new EventSource('/api/events')
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data))
    } catch {
      // ignore malformed SSE
    }
  }
  return () => source.close()
}

export function isNotice(value: unknown): value is { type: 'notice'; notice: Notice } {
  return Boolean(value && typeof value === 'object' && (value as { type?: string }).type === 'notice')
}
