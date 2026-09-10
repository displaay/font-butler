import { useEffect, useId, useRef, useState } from 'react'
import { SettingsRow, SettingsSection } from '@/components/SettingsRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import {
  retailDriftSummary,
  type RetailSkipReason,
  type RetailSyncStatus,
  type WatchFolder,
} from '@/lib/types'
import { watchFolderName } from '@/lib/watchFolders'

const BLOCKED_KINDS = new Set(['conflict', 'refused'])

function skipLabel(reason: RetailSkipReason): string {
  switch (reason) {
    case 'regenerating':
      return 'being regenerated right now'
    case 'no-active-revision':
      return 'has no active revision'
    case 'no-transaction':
      return 'has never been generated'
    case 'transaction-not-succeeded':
      return 'last generation did not finish'
    case 'incomplete':
      return 'still uploading'
    case 'no-files':
      return 'has no desktop fonts'
    default:
      return 'could not be read'
  }
}

/**
 * The optional DISPLAAY retail collection.
 *
 * Checking and syncing are always explicit actions — never on mount and never automatic — so a slow or
 * unreachable worker can't stall the app, the same rule the app-update check follows.
 */
export function RetailPane({
  status,
  folders,
  busy,
  onStatus,
  onAddFolder,
}: {
  status: RetailSyncStatus | null
  folders: WatchFolder[]
  busy: boolean
  onStatus: (status: RetailSyncStatus) => void
  onAddFolder: () => void
}) {
  const urlId = useId()
  const tokenId = useId()
  const folderId = useId()
  const [token, setToken] = useState('')
  // `status` is null on the first render, so the field cannot be seeded from it directly — an edited
  // value wins, otherwise fall back to whatever the server reports.
  const [editedUrl, setEditedUrl] = useState<string | null>(null)
  const workerBaseUrl = editedUrl ?? status?.workerBaseUrl ?? ''
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = busy || working
  const loadedRef = useRef(false)

  // `/api/retail/status` reads settings and the local manifest only — no network — so it is safe on
  // first render. Checking the worker stays an explicit action.
  useEffect(() => {
    if (status || loadedRef.current) return
    loadedRef.current = true
    void api.retail
      .status()
      .then((result) => onStatus(result.status))
      .catch(() => {
        loadedRef.current = false
      })
  }, [status, onStatus])

  const run = async (action: () => Promise<{ status: RetailSyncStatus }>) => {
    setWorking(true)
    setError(null)
    try {
      onStatus((await action()).status)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.')
    } finally {
      setWorking(false)
    }
  }

  const blocked = (status?.drift ?? []).filter((item) => BLOCKED_KINDS.has(item.kind))

  return (
    <div>
      <SettingsSection>
        <SettingsRow
          label="Sync the DISPLAAY retail collection"
          description="Keeps a watch folder in step with the fonts generated for the retail collection."
        >
          <Button
            variant={status?.enabled ? 'secondary' : 'default'}
            disabled={disabled}
            onClick={() => void run(() => api.retail.configure({ enabled: !status?.enabled }))}
          >
            {status?.enabled ? 'On' : 'Off'}
          </Button>
        </SettingsRow>

        <SettingsRow
          label="Folder"
          htmlFor={folderId}
          description={
            status?.folderRoot
              ? status.folderRoot
              : 'Pick which watch folder holds the collection. Font Buttler writes into it.'
          }
        >
          {folders.length > 0 ? (
            <select
              id={folderId}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={folders.find((folder) => folder.root === status?.folderRoot)?.id ?? ''}
              disabled={disabled}
              onChange={(event) =>
                void run(() => api.retail.configure({ folderId: event.target.value || null }))
              }
            >
              <option value="">Not set</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {watchFolderName(folder.root)}
                </option>
              ))}
            </select>
          ) : (
            <Button variant="secondary" disabled={disabled} onClick={onAddFolder}>
              Add a watch folder
            </Button>
          )}
        </SettingsRow>

        <SettingsRow
          label="Worker address"
          htmlFor={urlId}
          description="The DISPLAAY worker that serves the collection."
        >
          <Input
            id={urlId}
            className="w-72"
            value={workerBaseUrl}
            disabled={disabled}
            placeholder="https://w.displaay.net"
            onChange={(event) => setEditedUrl(event.target.value)}
            onBlur={() => {
              if (workerBaseUrl && workerBaseUrl !== status?.workerBaseUrl) {
                void run(async () => {
                  const result = await api.retail.configure({ workerBaseUrl })
                  setEditedUrl(null)
                  return result
                })
              }
            }}
          />
        </SettingsRow>

        <SettingsRow
          label="Worker token"
          htmlFor={tokenId}
          description={
            status?.hasToken
              ? 'A token is saved. Type a new one to replace it, or remove it.'
              : 'Paste the DISPLAAY worker token. It is stored outside the settings file.'
          }
        >
          <div className="flex gap-2">
            <Input
              id={tokenId}
              type="password"
              className="w-56"
              value={token}
              disabled={disabled}
              placeholder={status?.hasToken ? '••••••••' : 'Token'}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={disabled || !token}
              onClick={() =>
                void run(async () => {
                  const result = await api.retail.configure({ token })
                  setToken('')
                  return result
                })
              }
            >
              Save
            </Button>
            {status?.hasToken ? (
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => void run(() => api.retail.configure({ token: '' }))}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Status">
        <SettingsRow
          label={status ? retailDriftSummary(status) : 'Not checked yet.'}
          description={
            status?.checkedAt
              ? `Last checked ${new Date(status.checkedAt).toLocaleString()}.`
              : status?.enabled
                ? 'Check to compare the collection on the server against this Mac.'
                : 'Turn the collection on to check it.'
          }
        >
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={disabled || !status?.enabled}
              onClick={() => void run(() => api.retail.check(true))}
            >
              Check
            </Button>
            <Button
              disabled={disabled || !status?.enabled || !status?.pending}
              onClick={() => void run(() => api.retail.sync())}
            >
              {status?.pending ? `Sync ${status.pending}` : 'Sync'}
            </Button>
          </div>
        </SettingsRow>

        {error || status?.error ? (
          <SettingsRow
            label="Last error"
            description={error ?? status?.error ?? ''}
            className="text-destructive"
          />
        ) : null}

        {blocked.length > 0 ? (
          <SettingsRow
            label={`${blocked.length} ${blocked.length === 1 ? 'file needs' : 'files need'} attention`}
            description={blocked
              .slice(0, 3)
              .map((item) => item.note ?? item.relativePath)
              .join(' ')}
          />
        ) : null}

        {status && status.skipped.length > 0 ? (
          <SettingsRow
            label={`${status.skipped.length} ${status.skipped.length === 1 ? 'family' : 'families'} not available`}
            description={status.skipped
              .slice(0, 4)
              .map((skip) => `${skip.glyphsFile} ${skipLabel(skip.reason)}`)
              .join(' · ')}
          />
        ) : null}
      </SettingsSection>
    </div>
  )
}
