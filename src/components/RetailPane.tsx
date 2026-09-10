import { useEffect, useId, useRef, useState } from 'react'
import { DisplaayMark } from '@/components/DisplaayMark'
import { SettingsRow, SettingsSection, settingsSelectClass } from '@/components/SettingsRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import {
  DEFAULT_RETAIL_AUTOCHECK_MINUTES,
  RETAIL_AUTOCHECK_CHOICES,
  retailDriftSummary,
  type RetailSkipReason,
  type RetailSyncStatus,
} from '@/lib/types'
import { cn } from '@/lib/utils'

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
      return 'has no files on the worker yet'
    case 'no-files':
      return 'has no desktop fonts'
    default:
      return 'could not be read'
  }
}

/**
 * The optional Displaay retail collection.
 *
 * Checking and syncing are always explicit actions — never on mount and never automatic — so a slow or
 * unreachable worker can't stall the app, the same rule the app-update check follows.
 */
export function RetailPane({
  status,
  busy,
  onStatus,
}: {
  status: RetailSyncStatus | null
  busy: boolean
  onStatus: (status: RetailSyncStatus) => void
}) {
  const urlId = useId()
  const tokenId = useId()
  const autoCheckId = useId()
  const [token, setToken] = useState('')
  // `status` is null on the first render, so the field cannot be seeded from it directly — an edited
  // value wins, otherwise fall back to whatever the server reports.
  const [editedUrl, setEditedUrl] = useState<string | null>(null)
  const workerBaseUrl = editedUrl ?? status?.workerBaseUrl ?? ''
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = busy || working
  const loadedRef = useRef(false)
  const enabled = Boolean(status?.enabled)

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
  const lastError = error ?? status?.error ?? null

  return (
    <SettingsSection
      title={
        <>
          <DisplaayMark className="size-4" />
          Displaay retail
        </>
      }
    >
      <SettingsRow
        label="Sync"
        description="Keep the latest versions of all fonts from the Displaay retail collection."
      >
        <div
          role="radiogroup"
          aria-label="Displaay retail sync"
          className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5"
        >
          {(
            [
              { id: false, label: 'Off' },
              { id: true, label: 'On' },
            ] as const
          ).map((option) => {
            const selected = enabled === option.id
            return (
              <Button
                key={option.label}
                type="button"
                size="sm"
                variant="ghost"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                className={cn(
                  'h-7 px-2.5',
                  selected ? 'bg-muted font-medium' : 'text-muted-foreground',
                )}
                onClick={() => {
                  if (!selected) void run(() => api.retail.configure({ enabled: option.id }))
                }}
              >
                {option.label}
              </Button>
            )
          })}
        </div>
      </SettingsRow>

      {enabled ? (
        <>
      <SettingsRow
        label="Worker address"
        htmlFor={urlId}
        description="The Displaay worker that serves the collection."
      >
        <Input
          id={urlId}
          className="w-[min(18rem,100%)]"
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
        label="Check automatically"
        htmlFor={autoCheckId}
        description="How often to look for newer retail fonts. Checking never runs at startup."
      >
        <select
          id={autoCheckId}
          className={settingsSelectClass}
          value={status?.autoCheckMinutes ?? DEFAULT_RETAIL_AUTOCHECK_MINUTES}
          disabled={disabled}
          onChange={(event) =>
            void run(() => api.retail.configure({ autoCheckMinutes: Number(event.target.value) }))
          }
        >
          {RETAIL_AUTOCHECK_CHOICES.map((choice) => (
            <option key={choice.minutes} value={choice.minutes}>
              {choice.label}
            </option>
          ))}
        </select>
      </SettingsRow>

      <SettingsRow
        label="Worker token"
        htmlFor={tokenId}
        description={
          status?.hasToken
            ? 'A token is saved. Type a new one to replace it, or remove it.'
            : 'Paste the Displaay worker token. It is stored outside the settings file.'
        }
      >
        <div className="flex max-w-[min(100%,22rem)] flex-wrap items-center justify-end gap-1.5">
          <Input
            id={tokenId}
            type="password"
            className="w-44"
            value={token}
            disabled={disabled}
            placeholder={status?.hasToken ? '••••••••' : 'Token'}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
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
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void run(() => api.retail.configure({ token: '' }))}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </SettingsRow>

      <div className="py-3.5">
        <div className="rounded-lg border bg-muted/30 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {status ? retailDriftSummary(status) : 'Not checked yet.'}
              </div>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                {status?.checkedAt
                  ? `Last checked ${new Date(status.checkedAt).toLocaleString()}.`
                  : status?.enabled
                    ? 'Check to compare the collection on the server against this Mac.'
                    : 'Turn sync on to check the collection.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || !status?.enabled}
                onClick={() => void run(() => api.retail.check(true))}
              >
                Check
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={disabled || !status?.enabled || !status?.pending}
                onClick={() => void run(() => api.retail.sync())}
              >
                {status?.pending ? `Sync ${status.pending}` : 'Sync'}
              </Button>
            </div>
          </div>
          {lastError ? (
            <p className="mt-2 text-[13px] leading-5 text-destructive">{lastError}</p>
          ) : null}
          {blocked.length > 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              {blocked.length === 1 ? '1 file needs attention' : `${blocked.length} files need attention`}
              {': '}
              {blocked
                .slice(0, 3)
                .map((item) => item.note ?? item.relativePath)
                .join(' ')}
            </p>
          ) : null}
          {status && status.skipped.length > 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              {status.skipped.length === 1 ? '1 family not available' : `${status.skipped.length} families not available`}
              {' · '}
              {status.skipped
                .slice(0, 4)
                .map((skip) => `${skip.glyphsFile} ${skipLabel(skip.reason)}`)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
        </>
      ) : null}
    </SettingsSection>
  )
}
