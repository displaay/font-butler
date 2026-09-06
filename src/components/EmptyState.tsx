import { useRef } from 'react'
import { toast } from 'sonner'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Tab } from '@/components/Sidebar'
import { isDroppedFontName } from '@/lib/drop'
import { FONT_FILE_ACCEPT } from '@/lib/results'

export function EmptyState({
  tab,
  watchFolderName,
  projectName,
  onPickFiles,
}: {
  tab: Tab
  watchFolderName?: string | null
  projectName?: string | null
  onPickFiles: (files: FileList | File[]) => void
}) {
  const folderInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <label className="flex cursor-pointer flex-col items-center">
        <p className="text-base font-medium tracking-tight">
          {projectName
            ? `No fonts in ${projectName}`
            : watchFolderName
              ? `No fonts in ${watchFolderName}`
              : tab === 'updates'
                ? 'No source updates'
                : 'Drop font files or folders here'}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {projectName
            ? `Drop font files or a folder here to add them to ${projectName}.`
            : watchFolderName
              ? 'Drop fonts into this folder in Finder, or drop them here to add them.'
              : tab === 'library'
                ? 'Fonts already in My Fonts appear here. Drop a folder to add every TrueType and OpenType file inside it, including collections and subfolders. You can also watch a folder so new fonts are imported automatically. Uninstalling keeps a family here only when a separate source file is still on disk.'
                : 'Uninstalling keeps a family here only when a separate source file is still on disk.'}
        </p>
        <input
          type="file"
          accept={FONT_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) onPickFiles(event.target.files)
          }}
        />
      </label>
      {tab === 'library' && (
        <>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            {...{ webkitdirectory: '', directory: '' }}
            onChange={(event) => {
              const list = event.target.files
              if (!list) return
              const fonts = Array.from(list).filter((file) => isDroppedFontName(file.name))
              if (fonts.length === 0) {
                toast.error('No font files in that folder.')
                return
              }
              onPickFiles(fonts)
              event.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderOpen /> Choose folder
          </Button>
        </>
      )}
    </div>
  )
}
