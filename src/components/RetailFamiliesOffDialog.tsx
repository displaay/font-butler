import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { RetailDisableAction } from '@/lib/types'

export function retailFamiliesOffDescription(syncing: boolean, installed: number): string {
  const what =
    installed === 0
      ? 'Fonts that finish installing'
      : installed === 1
        ? '1 family is already installed. It'
        : `${installed} families are already installed. They`
  const lead = syncing ? 'Syncing stops now. ' : ''
  return `${lead}${what} can stay on your Mac as regular fonts, or be uninstalled. Fonts not installed yet are removed from the list either way.`
}

export function RetailFamiliesOffDialog({
  open,
  syncing,
  installed,
  onDismiss,
  onChoose,
}: {
  open: boolean
  syncing: boolean
  installed: number
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
          <DialogTitle>Stop syncing these fonts?</DialogTitle>
          <DialogDescription>{retailFamiliesOffDescription(syncing, installed)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button onClick={() => onChoose('keep')}>Keep installed, stop syncing</Button>
          <Button variant="outline" onClick={() => onChoose('remove')}>
            Uninstall them
          </Button>
          <Button variant="ghost" onClick={onDismiss}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
