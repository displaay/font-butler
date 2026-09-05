import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatLabel } from '@/lib/formats'

export function ReplaceFormatDialog({
  open,
  incomingFormat,
  existingFormat,
  names,
  onCancel,
  onKeep,
  onReplace,
}: {
  open: boolean
  incomingFormat: string
  existingFormat: string
  names: string[]
  onCancel: () => void
  onKeep: () => void
  onReplace: () => void
}) {
  const incoming = formatLabel(incomingFormat)
  const existing = formatLabel(existingFormat)
  const many = names.length > 1
  const title = many ? `Replace ${existing} with ${incoming}?` : `Replace ${names[0] ?? 'this font'}?`
  const description = many
    ? `${names.length} styles are already installed as ${existing}. Replace them with ${incoming}, or keep the installed files.`
    : `${names[0] ?? 'This font'} is already installed as ${existing}. Replace it with ${incoming}, or keep the installed file.`

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {many && (
          <ul className="mb-4 max-h-40 space-y-1 overflow-y-auto text-sm text-muted-foreground">
            {names.map((name) => (
              <li key={name} className="truncate" title={name}>
                {name}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onKeep}>
            Keep existing
          </Button>
          <Button onClick={onReplace}>Replace</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
