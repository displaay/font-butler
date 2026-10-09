import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

export const FONT_CACHE_CLEAR_WARNING =
  'Some apps may not see new or updated fonts until you log out.'

type Phase = 'idle' | 'confirm' | 'clearing' | 'cleared'

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
      await onClear()
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
                    const outcome = result as { requested?: boolean; message?: string } | undefined
                    if (outcome && outcome.requested === false) {
                      setLogoutFallback(outcome.message || 'Use Apple menu > Log Out')
                      return
                    }
                    setPhase('idle')
                  })
                  .catch(() => {
                    setLogoutFallback('Use Apple menu > Log Out')
                  })
              }}
            >
              Log out now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
