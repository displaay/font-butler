import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { DESTINATIONS, WATCH_FOLDER_ACTIONS, adobeTestingFolderAvailable, destinationNeedsAdobe } from '@/lib/folders'
import type { DefaultDestinationId, ImportPlan, WatchFolder } from '@/lib/types'

export function FolderSetupDialog({
  open,
  roots,
  onOpenChange,
  onDone,
  deferInstall = false,
}: {
  open: boolean
  roots?: string[]
  onOpenChange: (open: boolean) => void
  onDone: (folders: WatchFolder[]) => void
  /** Record the folder without watching or installing; used while onboarding is open. */
  deferInstall?: boolean
}) {
  const [root, setRoot] = useState(roots?.[0] ?? '')
  const extraRoots = roots?.slice(1) ?? []
  const [installNew, setInstallNew] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [destinationId, setDestinationId] = useState<DefaultDestinationId>('macos')
  const [exclusions, setExclusions] = useState('')
  const [discovery, setDiscovery] = useState<ImportPlan | null>(null)
  const [folder, setFolder] = useState<WatchFolder | null>(null)
  const [busy, setBusy] = useState(false)
  const [adobeSupported, setAdobeSupported] = useState(true)

  useEffect(() => {
    if (!open) return
    setRoot(roots?.[0] ?? '')
    setInstallNew(true)
    setAutoUpdate(true)
    setDestinationId('macos')
    setExclusions('')
    setDiscovery(null)
    setFolder(null)
    void api
      .destinations()
      .then((result) => {
        setAdobeSupported(adobeTestingFolderAvailable(result.destinations))
      })
      .catch(() => setAdobeSupported(true))
  }, [open, roots])

  const parsedExclusions = exclusions
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)

  async function configure(
    nextRoot = root,
    nextInstallNew = installNew,
    nextAutoUpdate = autoUpdate,
    nextDestination = destinationId,
  ) {
    if (!nextRoot.trim()) return
    setBusy(true)
    try {
      const result = await api.configureFolder({
        root: nextRoot.trim(),
        installNew: nextInstallNew,
        autoUpdate: nextAutoUpdate,
        exclusions: parsedExclusions,
        destinationId: nextDestination,
      })
      setFolder(result.folder)
      setDiscovery(result.discovery)
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not configure that folder.')
      return undefined
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    setBusy(true)
    try {
      const first = folder ?? (await configure())?.folder
      if (!first) return
      const started = [await api.startWatching(first.id).then((result) => result.folder)]
      for (const extra of extraRoots) {
        const configured = await api.configureFolder({
          root: extra,
          installNew,
          autoUpdate,
          exclusions: parsedExclusions,
          destinationId,
        })
        started.push((await api.startWatching(configured.folder.id)).folder)
      }
      onDone(started)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start watching.')
    } finally {
      setBusy(false)
    }
  }

  const summary = discovery?.summary

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogHeader>
          <DialogTitle>Watch folder</DialogTitle>
          <DialogDescription>
            {deferInstall
              ? 'Choose what this folder does. Fonts are not installed until you finish setup.'
              : 'Choose what this folder does before Font Buttler scans or installs anything. Starting watch applies only the operations shown below.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={root}
              placeholder="/Users/you/Fonts/Inbox"
              aria-label="Folder path"
              onChange={(event) => setRoot(event.target.value)}
            />
            {window.fontButlerDesktop?.pickFolder ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void window.fontButlerDesktop?.pickFolder().then((picked) => {
                    if (!picked) return
                    setRoot(picked)
                    void configure(picked)
                  })
                }
              >
                <FolderOpen /> Choose
              </Button>
            ) : null}
          </div>
          {extraRoots.length > 0 && (
            <p className="text-xs text-muted-foreground">
              And {extraRoots.length} more folder{extraRoots.length === 1 ? '' : 's'} with the same choices.
            </p>
          )}
          <div className="space-y-2 rounded-lg border px-3 py-2">
            {WATCH_FOLDER_ACTIONS.map((action) => {
              const checked = action.key === 'installNew' ? installNew : autoUpdate
              return (
                <label key={action.key} className="flex items-start justify-between gap-3 py-1">
                  <span>
                    <span className="block text-sm font-medium">{action.label}</span>
                    <span className="block text-xs text-muted-foreground">{action.description}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border border-input accent-primary"
                    checked={checked}
                    aria-label={action.label}
                    onChange={(event) => {
                      const nextInstall = action.key === 'installNew' ? event.target.checked : installNew
                      const nextUpdate = action.key === 'autoUpdate' ? event.target.checked : autoUpdate
                      setInstallNew(nextInstall)
                      setAutoUpdate(nextUpdate)
                      if (root.trim()) void configure(root, nextInstall, nextUpdate)
                    }}
                  />
                </label>
              )
            })}
            <p className="text-xs text-muted-foreground">
              Both start on. This folder&apos;s checkboxes win over the global reinstall setting.
            </p>
          </div>
          <Label className="block space-y-1 font-normal">
            <span className="text-sm">Install destination</span>
            <select
              className="h-8 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              aria-label="Install destination"
              value={destinationId}
              onChange={(event) => {
                const next = event.target.value as DefaultDestinationId
                setDestinationId(next)
                if (root.trim()) void configure(root, installNew, autoUpdate, next)
              }}
            >
              {DESTINATIONS.filter((option) => adobeSupported || !destinationNeedsAdobe(option.id)).map(
                (option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ),
              )}
            </select>
            {adobeSupported ? (
              <span className="block text-xs text-muted-foreground">
                Adobe folder places files only. It is unavailable until that folder exists and
                is writable.
              </span>
            ) : null}
          </Label>
          <Label className="block space-y-1 font-normal">
            <span className="text-sm">Exclusions</span>
            <Input
              value={exclusions}
              placeholder="Drafts, *.bak"
              aria-label="Folder exclusions"
              onChange={(event) => setExclusions(event.target.value)}
              onBlur={() => {
                if (root.trim()) void configure()
              }}
            />
            <span className="block text-xs text-muted-foreground">
              Folder names or relative patterns. Exclusions stop automation, not catalog membership.
            </span>
          </Label>
          {summary && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {summary.add} add · {summary.install} install · {summary.unchanged} unchanged ·{' '}
              {summary.review} need review · {summary.preview} preview-only
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={busy || !root.trim()}
              onClick={() => void configure()}
            >
              Preview scan
            </Button>
            <Button disabled={busy || !root.trim()} onClick={() => void start()}>
              {deferInstall ? 'Add folder' : 'Start watching'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
