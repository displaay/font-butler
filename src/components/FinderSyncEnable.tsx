import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  FINDER_SYNC_ENABLE_DESCRIPTION,
  FINDER_SYNC_ENABLE_LABEL,
  FINDER_SYNC_LOGIN_ITEMS_BUTTON,
  FINDER_SYNC_SETTINGS_BUTTON,
  finderSyncEnableAction,
  type FinderSyncAgentStatusName,
} from '@/lib/finderSync'

function openFinderExtensionsSettings() {
  void window.fontButlerDesktop?.openFinderExtensions?.()
}

function openFinderSyncLoginItems() {
  void window.fontButlerDesktop?.openFinderSyncLoginItems?.()
}

export function FinderSyncEnableButton({
  disabled = false,
  status: statusProp,
}: {
  disabled?: boolean
  status?: FinderSyncAgentStatusName | string
}) {
  const [fetched, setFetched] = useState<{ status?: string; enabled?: boolean; error?: string } | null>(null)
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null)
  useEffect(() => {
    if (statusProp) return
    let cancelled = false
    void window.fontButlerDesktop?.getFinderSyncAgentStatus?.().then((result) => {
      if (cancelled || !result) return
      setFetched(result)
    })
    return () => {
      cancelled = true
    }
  }, [statusProp])
  const status = statusProp ?? fetched?.status ?? 'enabled'
  const enabled = enabledOverride ?? fetched?.enabled !== false
  const registrationError = statusProp ? '' : (fetched?.error ?? '')
  const action = finderSyncEnableAction(status)
  return (
    <div className="flex flex-col items-end gap-2">
      {registrationError ? (
        <p className="max-w-56 text-right text-[12px] leading-4 text-muted-foreground">{registrationError}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Finder menu in Login Items"
          checked={enabled}
          disabled={disabled || status === 'unsupported'}
          onChange={(event) => {
            const next = event.target.checked
            setEnabledOverride(next)
            void window.fontButlerDesktop?.setFinderSyncAgentEnabled?.(next).then((ok) => {
              if (ok === false) setEnabledOverride(!next)
            })
          }}
        />
        {action === 'none' ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={action === 'login-items' ? openFinderSyncLoginItems : openFinderExtensionsSettings}
          >
            {action === 'login-items' ? FINDER_SYNC_LOGIN_ITEMS_BUTTON : FINDER_SYNC_SETTINGS_BUTTON}
          </Button>
        )}
      </div>
    </div>
  )
}

export function FinderSyncEnableNote({
  disabled = false,
  status,
}: {
  disabled?: boolean
  status?: FinderSyncAgentStatusName | string
}) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{FINDER_SYNC_ENABLE_LABEL}</p>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{FINDER_SYNC_ENABLE_DESCRIPTION}</p>
      <div className="mt-3">
        <FinderSyncEnableButton disabled={disabled} status={status} />
      </div>
    </div>
  )
}
