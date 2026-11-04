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

export const CLEAR_ALL_FONT_CACHES_COPY =
  'This clears the macOS user font cache and, where turned on above, the Microsoft Office and Adobe font caches. It removes cache files only — no fonts or library entries are removed, and no administrator password is needed. Open apps may need to be relaunched to see updated fonts, and some apps may not see new or updated fonts until you log out.'

export type FontCachePartName = 'user' | 'office' | 'adobe'

export type FontCachePartOutcome = {
  part: FontCachePartName
  status: 'cleared' | 'not-cleared' | 'skipped' | 'failed'
  mac: boolean
  cleared: boolean
  simulated?: boolean
  error?: string
}

export type ClearAllFontCachesOutcome = {
  mac: boolean
  cleared: boolean
  simulated?: boolean
  confirmed?: boolean
  logoutProbe?: boolean
  parts: FontCachePartOutcome[]
}

export const FONT_CACHE_PART_LABELS: Record<FontCachePartName, string> = {
  user: 'macOS user font cache',
  office: 'Microsoft Office font cache',
  adobe: 'Adobe font caches',
}

export function fontCachePartStatusText(part: FontCachePartOutcome): string {
  if (part.status === 'failed') {
    return part.error ? `Could not be cleared — ${part.error}` : 'Could not be cleared'
  }
  if (part.status === 'skipped') return 'Skipped — turned off above'
  if (part.simulated) return 'Not cleared in this test build'
  if (part.status === 'cleared') return 'Cleared'
  return part.mac ? 'Nothing to clear' : 'Available on macOS only'
}

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

type AllPhase = 'idle' | 'confirm' | 'clearing' | 'done' | 'logout-failed' | 'probe-allowed'

export function ClearAllFontCachesControl({
  disabled,
  onClearAll,
  onLogOut,
  onProbe,
}: {
  disabled?: boolean
  onClearAll: () => Promise<ClearAllFontCachesOutcome>
  onLogOut: () => Promise<unknown>
  onProbe?: () => Promise<unknown>
}) {
  const [phase, setPhase] = useState<AllPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ClearAllFontCachesOutcome | null>(null)
  const [logoutFallback, setLogoutFallback] = useState<string | null>(null)
  const [probe, setProbe] = useState(false)

  useEffect(() => {
    if (phase !== 'done' || !probe) return
    return subscribeLogoutProbeResult(() => {
      setPhase('probe-allowed')
    })
  }, [phase, probe])

  async function confirmClear() {
    setPhase('clearing')
    setError(null)
    try {
      const outcome = await onClearAll()
      setResult(outcome)
      setProbe(outcome.logoutProbe === true)
      setPhase('done')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clear font caches.')
      setPhase('confirm')
    }
  }

  function closeDone() {
    setProbe(false)
    setResult(null)
    setLogoutFallback(null)
    setPhase('idle')
  }

  const failed = result?.parts.some((part) => part.status === 'failed') ?? false
  const userPart = result?.parts.find((part) => part.part === 'user')
  const showLogout = Boolean(result && (probe || (userPart?.cleared && !userPart.simulated)))

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
        Clear all font caches
      </Button>
      <Dialog
        open={phase === 'confirm' || phase === 'clearing'}
        onOpenChange={(open) => {
          if (!open && phase !== 'clearing') setPhase('idle')
        }}
      >
        <DialogContent>
          <DialogTitle>Clear all font caches?</DialogTitle>
          <DialogDescription>{CLEAR_ALL_FONT_CACHES_COPY}</DialogDescription>
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
              Clear all font caches
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={phase === 'done'}
        onOpenChange={(open) => {
          if (!open) closeDone()
        }}
      >
        <DialogContent>
          <DialogTitle>
            {failed ? 'Some font caches were not cleared' : 'Font caches cleared'}
          </DialogTitle>
          <DialogDescription>
            {logoutFallback ??
              'Open apps may need to be relaunched to see updated fonts. Some apps may not see new or updated fonts until you log out.'}
          </DialogDescription>
          {result ? (
            <ul className="mt-2 space-y-1 text-sm">
              {result.parts.map((part) => (
                <li key={part.part}>
                  {FONT_CACHE_PART_LABELS[part.part]}: {fontCachePartStatusText(part)}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeDone}>
              {showLogout ? 'Later' : 'OK'}
            </Button>
            {showLogout ? (
              <Button
                type="button"
                onClick={() => {
                  const request = probe ? onProbe : onLogOut
                  if (!request) {
                    closeDone()
                    return
                  }
                  void request()
                    .then((outcome) => {
                      const value = outcome as
                        | {
                            requested?: boolean
                            cancelled?: boolean
                            ignored?: boolean
                            probeAllowed?: boolean
                            message?: string
                          }
                        | undefined
                      if (value && value.ignored === true) {
                        closeDone()
                        return
                      }
                      if (
                        probe &&
                        (value?.probeAllowed === true ||
                          value?.message === LOGOUT_PROBE_WOULD_START_NOTICE)
                      ) {
                        setPhase('probe-allowed')
                        return
                      }
                      if (value && value.requested === false) {
                        if (value.cancelled === true) {
                          setLogoutFallback(value.message || LOGOUT_CANCELLED)
                          return
                        }
                        setPhase('logout-failed')
                        return
                      }
                      if (probe && value?.requested === true) return
                      closeDone()
                    })
                    .catch(() => {
                      setPhase('logout-failed')
                    })
                }}
              >
                Log out now
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={phase === 'probe-allowed'}
        onOpenChange={(open) => {
          if (!open) closeDone()
        }}
      >
        <DialogContent>
          <DialogTitle>{LOGOUT_PROBE_WOULD_START_TITLE}</DialogTitle>
          <DialogDescription>{LOGOUT_PROBE_WOULD_START_NOTICE}</DialogDescription>
          <p className="text-sm text-muted-foreground">{LOGOUT_PROBE_WOULD_START_DETAIL}</p>
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={closeDone}>
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <LogoutFailedDialog open={phase === 'logout-failed'} onClose={() => setPhase('idle')} />
    </>
  )
}
