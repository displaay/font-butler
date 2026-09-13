import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { RetailCollisionAction, RetailFamilyCollision } from '@/lib/types'

const checkboxClass = 'size-4 shrink-0 cursor-pointer rounded border border-input accent-primary'

export function RetailCollisionDialog({
  open,
  mode,
  collision,
  remaining,
  busy,
  onDismiss,
  onChoose,
}: {
  open: boolean
  mode: 'sync' | 'drop'
  collision: RetailFamilyCollision | null
  remaining: number
  busy?: boolean
  onDismiss: () => void
  onChoose: (action: RetailCollisionAction, applyToAll: boolean) => void
}) {
  const applyId = useId()
  const [applyToAll, setApplyToAll] = useState(false)
  useEffect(() => {
    setApplyToAll(false)
  }, [collision?.familyName])
  const family = collision?.familyName ?? 'This font'
  const more = remaining > 1
  const title =
    mode === 'sync' ? `${family} is already installed` : `${family} is installed from Displaay retail`
  const description =
    mode === 'sync'
      ? `${family} is already installed outside the Displaay retail collection${
          collision?.installedLabel ? ` (${collision.installedLabel})` : ''
        }. Choose what Sync should do.`
      : `Dropped files match ${family}, which is currently installed from Displaay retail. This is not a silent overwrite.`
  const replaceLabel =
    mode === 'sync'
      ? 'Uninstall the old version and install the synced font'
      : 'Turn sync off and uninstall the Displaay version'
  const keepLabel =
    mode === 'sync'
      ? 'Keep the old version and turn sync off for this font'
      : 'Cancel and keep the Displaay version'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setApplyToAll(false)
          onDismiss()
        }
      }}
    >
      <DialogContent className="w-[min(94vw,480px)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {more ? (
          <label htmlFor={applyId} className="mb-4 flex items-center gap-2 text-sm">
            <input
              id={applyId}
              type="checkbox"
              className={checkboxClass}
              checked={applyToAll}
              disabled={busy}
              onChange={(event) => setApplyToAll(event.target.checked)}
            />
            Apply to all {remaining} remaining fonts in this {mode === 'sync' ? 'sync' : 'drop'}
          </label>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button
            disabled={busy || !collision}
            onClick={() => {
              onChoose('replace', applyToAll && more)
              setApplyToAll(false)
            }}
          >
            {replaceLabel}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !collision}
            onClick={() => {
              onChoose('keep', applyToAll && more)
              setApplyToAll(false)
            }}
          >
            {keepLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
