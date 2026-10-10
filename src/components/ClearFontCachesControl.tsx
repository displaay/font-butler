import { useEffect, useState } from 'react'
import {
  LOGOUT_CANCELLED,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_FAILED_TITLE,
  LOGOUT_PROBE_WOULD_START_DETAIL,
  LOGOUT_PROBE_WOULD_START_NOTICE,
  LOGOUT_PROBE_WOULD_START_TITLE,
} from '../../shared/logout.ts'
import { subscribeLogoutProbeResult } from '@/lib/logout-probe-result'
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

type Phase = 'idle' | 'confirm' | 'clearing' | 'cleared' | 'logout-failed' | 'probe-allowed'

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
  onProbe,
}: {
  disabled?: boolean
  onClear: () => Promise<unknown>
  onLogOut: () => Promise<unknown>
  onProbe?: () => Promise<unknown>
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [logoutFallback, setLogoutFallback] = useState<string | null>(null)
  const [probe, setProbe] = useState(false)

  useEffect(() => {
    if (phase !== 'cleared' || !probe) return
    return subscribeLogoutProbeResult(() => {
      setPhase('probe-allowed')
    })
  }, [phase, probe])

  async function confirmClear() {
    setPhase('clearing')
    setError(null)
    try {
      const result = await onClear()
      const outcome =
        result && typeof result === 'object'
          ? (result as { cleared?: boolean; logoutProbe?: boolean })
          : null
      const offerProbe = outcome?.logoutProbe === true
      if (outcome && 'cleared' in outcome && outcome.cleared === false && !offerProbe) {
        setProbe(false)
        setPhase('idle')
        return
      }
      setProbe(offerProbe)
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
          if (!open) {
            setPhase((current) => {
              if (current !== 'cleared') return current
              setProbe(false)
              return 'idle'
            })
          }
        }}
      >
        <DialogContent>
          <DialogTitle>Font caches cleared</DialogTitle>
          <DialogDescription>
            {logoutFallback ??
              `${FONT_CACHE_CLEAR_WARNING} macOS will ask you to confirm.`}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setProbe(false)
                setPhase('idle')
              }}
            >
              Later
            </Button>
            <Button
              type="button"
              onClick={() => {
                const request = probe ? onProbe : onLogOut
                if (!request) {
                  setProbe(false)
                  setPhase('idle')
                  return
                }
                void request()
                  .then((result) => {
                    const outcome = result as
                      | {
                          requested?: boolean
                          cancelled?: boolean
                          ignored?: boolean
                          probeAllowed?: boolean
                          message?: string
                        }
                      | undefined
                    if (outcome && outcome.ignored === true) {
                      setProbe(false)
                      setPhase('idle')
                      return
                    }
                    if (
                      probe &&
                      (outcome?.probeAllowed === true ||
                        outcome?.message === LOGOUT_PROBE_WOULD_START_NOTICE)
                    ) {
                      setPhase('probe-allowed')
                      return
                    }
                    if (outcome && outcome.requested === false) {
                      if (outcome.cancelled === true) {
                        setLogoutFallback(outcome.message || LOGOUT_CANCELLED)
                        return
                      }
                      setPhase('logout-failed')
                      return
                    }
                    if (probe && outcome?.requested === true) {
                      // Allow can land after this accept-window result. The
                      // probe notice moves the panel; Log out now stays until then.
                      return
                    }
                    setProbe(false)
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
      <Dialog
        open={phase === 'probe-allowed'}
        onOpenChange={(open) => {
          if (!open) {
            setProbe(false)
            setPhase('idle')
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{LOGOUT_PROBE_WOULD_START_TITLE}</DialogTitle>
          <DialogDescription>{LOGOUT_PROBE_WOULD_START_NOTICE}</DialogDescription>
          <p className="text-sm text-muted-foreground">{LOGOUT_PROBE_WOULD_START_DETAIL}</p>
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={() => {
                setProbe(false)
                setPhase('idle')
              }}
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <LogoutFailedDialog open={phase === 'logout-failed'} onClose={() => setPhase('idle')} />
    </>
  )
}
