import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSetActionStatus } from '@/components/NotifyProvider'
import { api } from '@/lib/api'
import type { CatalogEntry } from '@/lib/types'
import { familyNameOf } from '@/lib/group'

export function RenameDialog({
  entry,
  open,
  onOpenChange,
  onDone,
}: {
  entry: CatalogEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (entry: CatalogEntry) => void
}) {
  const setActionStatus = useSetActionStatus()
  const original = entry ? familyNameOf(entry) : ''
  const [name, setName] = useState(original)
  const [preview, setPreview] = useState({ fullName: '', postscriptName: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(original)
  }, [original, open])

  useEffect(() => {
    if (!entry || !name.trim()) return
    const handle = window.setTimeout(() => {
      void api.renamePreview(entry.id, name.trim()).then(setPreview)
    }, 120)
    return () => window.clearTimeout(handle)
  }, [entry, name])

  async function install() {
    if (!entry || !name.trim()) return
    setBusy(true)
    setActionStatus(`Installing as ${name.trim()}…`)
    try {
      const result = await api.install(entry.id, name.trim())
      toast.success(`Installed as ${name.trim()}`)
      onDone(result.entry)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Install as failed')
    } finally {
      setBusy(false)
      setActionStatus(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install as a different name</DialogTitle>
          <DialogDescription>
            Font Buttler writes a copy with a new family name in the name and CFF
            tables. Your source file stays unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="family-name">Family name</Label>
            <Input
              id="family-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New family name"
              autoFocus
            />
          </div>
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">
            <div>
              Full name <span className="font-medium">{preview.fullName || '—'}</span>
            </div>
            <div className="mt-1 text-muted-foreground">
              PostScript {preview.postscriptName || '—'}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void install()} disabled={busy || !name.trim()}>
              {busy ? 'Installing…' : 'Install renamed copy'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
