import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { RetailDisableAction } from '@/lib/types'

export function RetailDisableDialog({
  open,
  busy,
  onDismiss,
  onChoose,
}: {
  open: boolean
  busy?: boolean
  onDismiss: () => void
  onChoose: (action: RetailDisableAction) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss()
      }}
    >
      <DialogContent className="w-[min(94vw,480px)]">
        <DialogHeader>
          <DialogTitle>Turn off Displaay retail?</DialogTitle>
          <DialogDescription>
            Keep the fonts installed, or uninstall them and remove them from the library.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button disabled={busy} onClick={() => onChoose('keep')}>
            Keep fonts installed
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onChoose('remove')}>
            Uninstall and remove from the list
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
