import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { openAppUpdateUrl } from '@/lib/app-update'
import {
  RETAIL_EULA_DATE,
  RETAIL_EULA_URL,
  RETAIL_EULA_VERSION,
} from '@/lib/types'

export function RetailEulaDialog({
  open,
  busy,
  onDismiss,
  onAccept,
}: {
  open: boolean
  busy?: boolean
  onDismiss: () => void
  onAccept: () => void
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
          <DialogTitle>Displaay End User Licence Agreement</DialogTitle>
          <DialogDescription>
            To sync Displaay retail fonts, accept the End User Licence Agreement (version{' '}
            {RETAIL_EULA_VERSION}, {RETAIL_EULA_DATE}).
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <button
            type="button"
            className="text-foreground underline underline-offset-2 hover:text-foreground/80"
            disabled={busy}
            onClick={() => {
              void openAppUpdateUrl(RETAIL_EULA_URL)
            }}
          >
            Read full terms
          </button>
        </p>
        <div className="flex flex-col gap-2">
          <Button disabled={busy} onClick={onAccept}>
            Accept and turn on
          </Button>
          <Button variant="outline" disabled={busy} onClick={onDismiss}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
