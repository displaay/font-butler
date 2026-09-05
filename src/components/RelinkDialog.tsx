import { useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { FONT_FILE_ACCEPT } from '@/lib/results'
import type { CatalogEntry, RelinkPreview } from '@/lib/types'

export function RelinkDialog({
  open,
  entry,
  mode,
  onOpenChange,
  onDone,
}: {
  open: boolean
  entry: CatalogEntry | null
  mode: 'locate' | 'link'
  onOpenChange: (open: boolean) => void
  onDone: (entry: CatalogEntry) => void
}) {
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<RelinkPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const title = mode === 'link' ? 'Link source…' : 'Locate source…'

  async function inspect(nextPath: string) {
    if (!entry || !nextPath.trim()) return
    setBusy(true)
    try {
      setPreview(await api.inspectRelink(entry.id, nextPath.trim()))
    } catch (error) {
      setPreview(null)
      toast.error(error instanceof Error ? error.message : 'That file cannot be linked.')
    } finally {
      setBusy(false)
    }
  }

  async function pickFile() {
    const picked = await window.fontButlerDesktop?.pickFile?.()
    if (!picked) return
    setPath(picked)
    await inspect(picked)
  }

  async function apply() {
    if (!entry || !preview?.identityMatch) return
    setBusy(true)
    try {
      const result = await api.applyRelink(entry.id, preview.proposedPath)
      onDone(result.entry)
      onOpenChange(false)
      setPreview(null)
      setPath('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not relink the source.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPreview(null)
          setPath('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Relinking updates the tracked source only. Installation stays a separate action.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={path}
              accept={FONT_FILE_ACCEPT}
              placeholder="/Users/you/Fonts/Family-Regular.otf"
              aria-label="Source file path"
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void inspect(path)
                }
              }}
            />
            {window.fontButlerDesktop?.pickFile ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void pickFile()}>
                <FolderOpen /> Choose
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled={busy || !path.trim()} onClick={() => void inspect(path)}>
                Inspect
              </Button>
            )}
          </div>
          {preview && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Current</dt>
              <dd className="truncate font-mono text-xs" title={preview.oldPath}>
                {preview.oldPath}
              </dd>
              <dt className="text-muted-foreground">Proposed</dt>
              <dd className="truncate font-mono text-xs" title={preview.proposedPath}>
                {preview.proposedPath}
              </dd>
              <dt className="text-muted-foreground">Identity</dt>
              <dd>{preview.identityMatch ? 'Matches this font' : 'Does not match'}</dd>
              <dt className="text-muted-foreground">Format</dt>
              <dd className="uppercase">{preview.format}</dd>
              <dt className="text-muted-foreground">Bytes</dt>
              <dd>{preview.bytesDiffer ? 'Different from the installed copy' : 'Same as the installed copy'}</dd>
              {preview.reason ? (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd>{preview.reason}</dd>
                </>
              ) : null}
            </dl>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !preview?.identityMatch} onClick={() => void apply()}>
              Link source
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
