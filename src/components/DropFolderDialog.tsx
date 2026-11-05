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
  onAddAsProject,
  onWatch,
}: {
  open: boolean
  folders: string[]
  onCancel: () => void
  onAddFonts: () => void
  onAddAsProject: () => void
  onWatch: () => void
}) {
  const names = folders.map(watchFolderName)
  const many = folders.length > 1
  const title = many ? `Add ${folders.length} folders?` : `Add ${names[0] ?? 'this folder'}?`
  const description = many
    ? 'Install the fonts once, install them into a new project, or add the folders as watch folders. A project does not watch these folders.'
    : `Install the fonts in ${names[0] ?? 'this folder'} once, install them into a new project, or add it as a watch folder. A project does not watch the folder.`

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="overflow-visible">
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
        <div className="flex flex-col gap-2">
          <Button className="w-full whitespace-normal" onClick={onWatch}>
            {many ? 'Add as watch folders' : 'Add as watch folder'}
          </Button>
          <Button variant="outline" className="w-full whitespace-normal" onClick={onAddAsProject}>
            Install fonts and create a project
          </Button>
          <Button variant="outline" className="w-full whitespace-normal" onClick={onAddFonts}>
            Install fonts
          </Button>
          <Button variant="outline" className="w-full" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
