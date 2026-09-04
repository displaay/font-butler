import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { watchFolderName } from '@/lib/watchFolders'

export function DropFolderDialog({
  open,
  folders,
  onCancel,
  onAddFonts,
  onWatch,
}: {
  open: boolean
  folders: string[]
  onCancel: () => void
  onAddFonts: () => void
  onWatch: () => void
}) {
  const names = folders.map(watchFolderName)
  const many = folders.length > 1
  const title = many ? `Add ${folders.length} folders?` : `Add ${names[0] ?? 'this folder'}?`
  const description = many
    ? 'Import the fonts inside these folders once, or watch them so new fonts are added automatically.'
    : `Import the fonts inside ${names[0] ?? 'this folder'} once, or watch the folder so new fonts are added automatically.`

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
          <ul className="mb-4 space-y-1 text-sm text-muted-foreground">
            {names.map((name, index) => (
              <li key={`${name}-${index}`} className="truncate" title={folders[index]}>
                {name}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onAddFonts}>
            Add fonts only
          </Button>
          <Button onClick={onWatch}>{many ? 'Watch folders' : 'Watch folder'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
