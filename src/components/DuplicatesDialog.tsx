import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatRelativeTime } from '@/lib/utils'
import type { CatalogEntry, DuplicateWarning } from '@/lib/types'

export type DuplicateChoice = 'replace' | 'add-inactive' | 'skip' | 'switch' | 'install-as'

export function DuplicatesDialog({
  open,
  warnings,
  entries,
  onClose,
  onResolve,
  busy,
}: {
  open: boolean
  warnings: DuplicateWarning[]
  entries: CatalogEntry[]
  onClose: () => void
  onResolve: (id: string, choice: DuplicateChoice, familyName?: string) => void
  busy: boolean
}) {
  const [names, setNames] = useState<Record<string, string>>({})

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setNames({})
          onClose()
        }
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,720px)] w-[min(94vw,720px)] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Duplicates</DialogTitle>
          <DialogDescription>
            Watched files that match an already active font. Nothing is installed until you choose.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending same-identity duplicates.</p>
          ) : (
            warnings.map((warning) => {
              const conflicts = warning.conflictingEntryIds
                .map((id) => entries.find((entry) => entry.id === id))
                .filter((entry): entry is CatalogEntry => Boolean(entry))
              const familyName = (names[warning.id] ?? '').trim()
              return (
                <div key={warning.id} className="space-y-2 rounded-lg border px-3 py-3">
                  <div className="text-sm font-medium">{warning.familyName || warning.path.split('/').pop()}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={warning.path}>
                    Watched: {warning.path}
                  </div>
                  {warning.incomingVersion ? (
                    <div className="text-xs text-muted-foreground">Incoming: {warning.incomingVersion}</div>
                  ) : null}
                  {warning.fingerprint ? (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      Fingerprint: {warning.fingerprint.slice(0, 12)}
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    {conflicts.map((entry) => (
                      <div key={entry.id} className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                        <div className="font-medium">
                          {entry.status === 'installed' || entry.status === 'outdated'
                            ? 'Active'
                            : entry.status === 'deactivated'
                              ? 'Parked'
                              : 'Inactive'}{' '}
                          · {entry.format.toUpperCase()}
                        </div>
                        <div className="truncate text-muted-foreground" title={entry.sourcePath}>
                          {entry.sourcePath}
                        </div>
                        <div className="text-muted-foreground">
                          Modified {formatRelativeTime(entry.sourceMtimeMs)}
                          {entry.installations?.length
                            ? ` · ${entry.installations.map((copy) => copy.destinationId).join(', ')}`
                            : entry.installedPath
                              ? ' · macos'
                              : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium" htmlFor={`duplicate-name-${warning.id}`}>
                      Install as… family name
                    </label>
                    <Input
                      id={`duplicate-name-${warning.id}`}
                      value={names[warning.id] ?? ''}
                      placeholder="A separate family name"
                      disabled={busy}
                      onChange={(event) =>
                        setNames((current) => ({ ...current, [warning.id]: event.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" disabled={busy} onClick={() => onResolve(warning.id, 'replace')}>
                      Replace active
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onResolve(warning.id, 'add-inactive')}
                    >
                      Add inactive copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !familyName}
                      onClick={() => onResolve(warning.id, 'install-as', familyName)}
                    >
                      Install as…
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onResolve(warning.id, 'switch')}
                    >
                      Switch
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onResolve(warning.id, 'skip')}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
