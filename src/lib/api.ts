import type { CatalogEntry, Notice, SystemFace } from './types'

async function json<T>(input: Promise<Response>): Promise<T> {
  const response = await input
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || response.statusText)
  }
  return data
}

export const api = {
  catalog: () => json<{ entries: CatalogEntry[] }>(fetch('/api/catalog')),
  system: () => json<{ faces: SystemFace[] }>(fetch('/api/system')),
  importPaths: (paths: string[]) =>
    json<{ entries: CatalogEntry[]; errors: string[] }>(
      fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      }),
    ),
  importFiles: (files: File[]) => {
    const body = new FormData()
    for (const file of files) body.append('files', file)
    return json<{ entries: CatalogEntry[]; errors: string[] }>(
      fetch('/api/import-files', { method: 'POST', body }),
    )
  },
  open: (path: string) =>
    json<{ entry: CatalogEntry }>(
      fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    ),
  install: (id: string, familyName?: string) =>
    json<{ entry: CatalogEntry }>(
      fetch('/api/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, familyName }),
      }),
    ),
  uninstall: (id: string) =>
    json<{ entry: CatalogEntry }>(
      fetch('/api/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    ),
  deactivate: (id: string) =>
    json<{ entry: CatalogEntry }>(
      fetch('/api/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    ),
  activate: (id: string) =>
    json<{ entry: CatalogEntry }>(
      fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    ),
  reinstall: (id: string) =>
    json<{ entry: CatalogEntry }>(
      fetch('/api/reinstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    ),
  uninstallSystem: (path: string) =>
    json<{ ok: boolean }>(
      fetch('/api/system/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    ),
  deactivateSystem: (path: string) =>
    json<{ ok: boolean }>(
      fetch('/api/system/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
    ),
  reveal: (payload: { id?: string; path?: string; which?: 'source' | 'installed' }) =>
    json<{ path: string }>(
      fetch('/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ),
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
