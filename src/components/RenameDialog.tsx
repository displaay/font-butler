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
import { bakeReportWarnings, suggestedBakeFamilyName } from '@/lib/otFeatures'

export function RenameDialog({
  entry,
  open,
  onOpenChange,
  onDone,
  bakeFeatures,
}: {
  entry: CatalogEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (entry: CatalogEntry) => void
  bakeFeatures?: string[] | null
}) {
  const setActionStatus = useSetActionStatus()
  const original = entry ? familyNameOf(entry) : ''
  const suggested = entry && bakeFeatures?.length
    ? suggestedBakeFamilyName(original, bakeFeatures)
    : original
  const [name, setName] = useState(suggested)
  const [preview, setPreview] = useState({ fullName: '', postscriptName: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(suggested)
  }, [suggested, open])

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
    const family = name.trim()
    setActionStatus(
      bakeFeatures?.length ? `Installing baked copy as ${family}…` : `Installing as ${family}…`,
    )
    try {
      if (bakeFeatures?.length) {
        const result = await api.bakeFeatures(entry.id, bakeFeatures, 'new-copy', family)
        toast.success(`Installed ${family} with ${bakeFeatures.join(', ')} baked in`)
        const warnings = bakeReportWarnings(result.report)
        if (warnings.length) toast.warning(warnings.join('\n'))
        onDone(result.entry)
      } else {
        const result = await api.install(entry.id, family)
        toast.success(`Installed as ${family}`)
        onDone(result.entry)
      }
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
            {bakeFeatures?.length
              ? 'Font Buttler bakes the selected OpenType features into default glyphs, then writes a copy with a new family name. Your source file stays unchanged.'
              : 'Font Buttler writes a copy with a new family name in the name and CFF tables. Your source file stays unchanged.'}
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
