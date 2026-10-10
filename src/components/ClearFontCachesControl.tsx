import { useState } from 'react'
import { LOGOUT_CANCELLED, LOGOUT_FAILED_MESSAGE, LOGOUT_FAILED_TITLE } from '../../shared/logout.ts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

export const FONT_CACHE_CLEAR_WARNING =
  'Some apps may not see new or updated fonts until you log out.'

export { LOGOUT_FAILED_TITLE, LOGOUT_FAILED_MESSAGE }

type Phase = 'idle' | 'confirm' | 'clearing' | 'cleared' | 'logout-failed'

export function LogoutFailedDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogTitle>{LOGOUT_FAILED_TITLE}</DialogTitle>
        <DialogDescription>{LOGOUT_FAILED_MESSAGE}</DialogDescription>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={onClose}>
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ClearFontCachesControl({
  disabled,
  onClear,
  onLogOut,
}: {
  disabled?: boolean
  onClear: () => Promise<unknown>
  onLogOut: () => Promise<unknown>
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [logoutFallback, setLogoutFallback] = useState<string | null>(null)

  async function confirmClear() {
    setPhase('clearing')
    setError(null)
    try {
      const result = await onClear()
      if (
        result &&
        typeof result === 'object' &&
        'cleared' in result &&
        (result as { cleared?: boolean }).cleared === false
      ) {
        setPhase('idle')
        return
      }
      setPhase('cleared')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clear font caches.')
      setPhase('confirm')
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || phase === 'clearing'}
        onClick={() => {
          setError(null)
          setLogoutFallback(null)
          setPhase('confirm')
        }}
      >
        Clear font caches
      </Button>
      <Dialog
        open={phase === 'confirm' || phase === 'clearing'}
        onOpenChange={(open) => {
          if (!open && phase !== 'clearing') setPhase('idle')
        }}
      >
        <DialogContent>
          <DialogTitle>Clear font caches?</DialogTitle>
          <DialogDescription>
            This removes the macOS user font cache. {FONT_CACHE_CLEAR_WARNING}
          </DialogDescription>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={phase === 'clearing'}
              onClick={() => setPhase('idle')}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={phase === 'clearing'}
              onClick={() => void confirmClear()}
            >
              Clear font caches
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={phase === 'cleared'}
        onOpenChange={(open) => {
          if (!open) setPhase('idle')
        }}
      >
        <DialogContent>
          <DialogTitle>Font caches cleared</DialogTitle>
          <DialogDescription>
            {logoutFallback ??
              `${FONT_CACHE_CLEAR_WARNING} macOS will ask you to confirm.`}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPhase('idle')}>
              Later
            </Button>
            <Button
              type="button"
              onClick={() => {
                void onLogOut()
                  .then((result) => {
                    const outcome = result as
                      | { requested?: boolean; cancelled?: boolean; message?: string }
                      | undefined
                    if (outcome && outcome.requested === false) {
                      if (outcome.cancelled === true) {
                        setLogoutFallback(outcome.message || LOGOUT_CANCELLED)
                        return
                      }
                      setPhase('logout-failed')
                      return
                    }
                    setPhase('idle')
                  })
                  .catch(() => {
                    setPhase('logout-failed')
                  })
              }}
            >
              Log out now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <LogoutFailedDialog open={phase === 'logout-failed'} onClose={() => setPhase('idle')} />
    </>
  )
}
