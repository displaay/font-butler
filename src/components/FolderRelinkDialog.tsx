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
import type { FolderRelinkPreview, FolderRelinkRow } from '@/lib/types'

export function FolderRelinkDialog({
  open,
  oldRoot,
  onOpenChange,
  onDone,
}: {
  open: boolean
  oldRoot: string
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [newRoot, setNewRoot] = useState('')
  const [preview, setPreview] = useState<FolderRelinkPreview | null>(null)
  const [selections, setSelections] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)

  async function inspect(root: string) {
    if (!oldRoot || !root.trim()) return
    setBusy(true)
    try {
      const next = await api.inspectFolderRelink(oldRoot, root.trim(), true)
      setPreview(next)
      const initial: Record<string, string | undefined> = {}
      for (const row of next.rows) {
        if (row.status === 'matched' || row.status === 'changed') {
          initial[row.entryId] = row.proposedPath
        }
      }
      setSelections(initial)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not inspect that folder.')
    } finally {
      setBusy(false)
    }
  }

  async function pickFolder() {
    const picked = await window.fontButlerDesktop?.pickFolder()
    if (!picked) return
    setNewRoot(picked)
    await inspect(picked)
  }

  async function apply() {
    if (!preview) return
    setBusy(true)
    try {
      await api.applyFolderRelink(preview.oldRoot, preview.newRoot, selections)
      onDone()
      onOpenChange(false)
      setPreview(null)
      setNewRoot('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not relink the folder.')
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
          setNewRoot('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,720px)] w-[min(94vw,720px)] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Relink folder…</DialogTitle>
          <DialogDescription>
            Map {oldRoot || 'the previous folder'} to a new root. Ambiguous matches need a choice;
            unmatched rows stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex gap-2">
            <Input
              value={newRoot}
              placeholder="/Users/you/Fonts/Client"
              aria-label="New folder path"
              onChange={(event) => setNewRoot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void inspect(newRoot)
                }
              }}
            />
            {window.fontButlerDesktop?.pickFolder ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void pickFolder()}>
                <FolderOpen /> Choose
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void inspect(newRoot)}>
                Inspect
              </Button>
            )}
          </div>
          {preview && (
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-2 font-medium">File</th>
                  <th className="pb-2 pr-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Match</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <FolderRelinkRowView
                    key={row.entryId}
                    row={row}
                    selected={selections[row.entryId]}
                    onSelect={(value) =>
                      setSelections((current) => ({ ...current, [row.entryId]: value }))
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !preview} onClick={() => void apply()}>
            Relink folder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FolderRelinkRowView({
  row,
  selected,
  onSelect,
}: {
  row: FolderRelinkRow
  selected?: string
  onSelect: (value: string | undefined) => void
}) {
  const label =
    row.status === 'changed'
      ? 'Changed version'
      : row.status === 'ambiguous'
        ? 'Ambiguous'
        : row.status === 'not-found'
          ? 'Not found'
          : 'Matched'
  return (
    <tr className="align-top">
      <td className="py-1.5 pr-2">
        <div className="truncate font-medium">{row.relativePath}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">{row.oldPath}</div>
      </td>
      <td className="py-1.5 pr-2">{label}</td>
      <td className="py-1.5">
        {row.status === 'ambiguous' ? (
          <select
            className="h-8 w-full rounded-md border bg-background px-1"
            value={selected ?? ''}
            aria-label={`Choose a match for ${row.relativePath}`}
            onChange={(event) => onSelect(event.target.value || undefined)}
          >
            <option value="">Choose…</option>
            {row.candidates.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        ) : (
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {selected || row.proposedPath || '—'}
          </span>
        )}
      </td>
    </tr>
  )
}
