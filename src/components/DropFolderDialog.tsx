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
    ? 'Add these as watch folders so new fonts are imported automatically, or upload the fonts inside them once.'
    : `Add ${names[0] ?? 'this folder'} as a watch folder so new fonts are imported automatically, or upload the fonts inside it once.`

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
            Upload fonts only
          </Button>
          <Button onClick={onWatch}>{many ? 'Add as watch folders' : 'Add as watch folder'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
