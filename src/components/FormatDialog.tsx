import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  fileCountLabel,
  formatExtension,
  formatLabel,
  preferredFormat,
  type FormatCount,
} from '@/lib/formats'
import { cn } from '@/lib/utils'

export function FormatDialog({
  open,
  formats,
  confirmVerb,
  onCancel,
  onConfirm,
}: {
  open: boolean
  formats: FormatCount[]
  confirmVerb: 'Install' | 'Add'
  onCancel: () => void
  onConfirm: (format: string) => void
}) {
  const [selected, setSelected] = useState(() => preferredFormat(formats.map((item) => item.format)))

  useEffect(() => {
    if (open) {
      setSelected(preferredFormat(formats.map((item) => item.format)))
    }
  }, [open, formats])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a format</DialogTitle>
          <DialogDescription>
            This drop includes more than one font format. Only one format can be
            installed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            {formats.map((item) => {
              const active = selected === item.format
              return (
                <button
                  key={item.format}
                  type="button"
                  onClick={() => setSelected(item.format)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active ? 'border-foreground bg-muted/60' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">{formatLabel(item.format)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatExtension(item.format)} · {fileCountLabel(item.count)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'size-3.5 rounded-full border',
                      active ? 'border-foreground bg-foreground' : 'border-muted-foreground/40',
                    )}
                  />
                </button>
              )
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={() => selected && onConfirm(selected)} disabled={!selected}>
              {selected ? `${confirmVerb} ${formatLabel(selected)}` : confirmVerb}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
