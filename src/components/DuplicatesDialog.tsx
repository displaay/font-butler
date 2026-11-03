import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { canSwitchToConflicts } from '@/lib/identity'
import type { CatalogEntry, DuplicateWarning } from '@/lib/types'

export type DuplicateChoice = 'replace' | 'add-inactive' | 'skip' | 'switch' | 'install-as'

export type DuplicateBatchChoice = 'skip' | 'replace'

function entryKnownFingerprints(entry: CatalogEntry): string[] {
  const found = new Set<string>()
  if (entry.sourceFingerprint) found.add(entry.sourceFingerprint)
  if (entry.installedFingerprint) found.add(entry.installedFingerprint)
  for (const copy of entry.installations ?? []) {
    if (copy.fingerprint) found.add(copy.fingerprint)
  }
  return [...found]
}

/** Client-side same-byte hint from catalog fingerprints (server also checks live paths). */
function isSameByteDuplicateWarning(
  warning: DuplicateWarning,
  entries: CatalogEntry[],
): boolean {
  if (!warning.fingerprint) return false
  const ids = [
    ...warning.conflictingEntryIds,
    ...(warning.activeEntryId ? [warning.activeEntryId] : []),
  ]
  for (const id of ids) {
    const entry = entries.find((item) => item.id === id)
    if (entry && entryKnownFingerprints(entry).includes(warning.fingerprint)) return true
  }
  return false
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

function installedRole(entry: CatalogEntry): string {
  if (entry.status === 'installed' || entry.status === 'outdated') return 'Installed now'
  if (entry.status === 'deactivated') return 'Parked'
  return 'Inactive'
}

function installedTitle(entry: CatalogEntry): string {
  return entry.customFamilyName?.trim() || entry.faces[0]?.familyName?.trim() || fileName(entry.sourcePath)
}

function versionText(version: string): string {
  const trimmed = version.trim()
  if (!trimmed) return ''
  return /^version\b/i.test(trimmed) ? trimmed : `Version ${trimmed}`
}

export function DuplicatesDialog({
  open,
  warnings,
  entries,
  onClose,
  onResolve,
  onResolveBatch,
  busy,
}: {
  open: boolean
  warnings: DuplicateWarning[]
  entries: CatalogEntry[]
  onClose: () => void
  onResolve: (id: string, choice: DuplicateChoice, familyName?: string) => void
  onResolveBatch: (
    ids: string[],
    choice: DuplicateBatchChoice,
    options?: { sameBytesOnly?: boolean },
  ) => void
  busy: boolean
}) {
  const [names, setNames] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [installAsId, setInstallAsId] = useState<string | null>(null)

  const sameByteIds = useMemo(
    () => warnings.filter((warning) => isSameByteDuplicateWarning(warning, entries)).map((w) => w.id),
    [warnings, entries],
  )
  const warningIds = useMemo(() => new Set(warnings.map((warning) => warning.id)), [warnings])
  const selectedIds = useMemo(
    () => warnings.filter((warning) => selected.has(warning.id)).map((warning) => warning.id),
    [warnings, selected],
  )
  const allSelected = warnings.length > 0 && selectedIds.length === warnings.length

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set([...current].filter((item) => warningIds.has(item)))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(warnings.map((warning) => warning.id)))
  }

  function resetAndClose() {
    setNames({})
    setSelected(new Set())
    setInstallAsId(null)
    onClose()
  }

  function submitInstallAs(id: string) {
    const familyName = (names[id] ?? '').trim()
    if (!familyName) return
    onResolve(id, 'install-as', familyName)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetAndClose()
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,720px)] w-[min(94vw,720px)] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Duplicates</DialogTitle>
          <DialogDescription>
            Incoming files that match an already active font. Nothing is installed until you choose.
          </DialogDescription>
        </DialogHeader>
        {warnings.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={busy}
                onChange={toggleAll}
                aria-label="Select all duplicates"
              />
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Select'}
            </label>
            <div className="ml-auto flex flex-wrap justify-end gap-1.5">
              {sameByteIds.length > 0 ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      onResolveBatch(sameByteIds, 'skip', { sameBytesOnly: true })
                    }
                  >
                    Dismiss same-byte matches ({sameByteIds.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      onResolveBatch(sameByteIds, 'replace', { sameBytesOnly: true })
                    }
                  >
                    Replace active (same bytes)
                  </Button>
                </>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || selectedIds.length === 0}
                onClick={() => onResolveBatch(selectedIds, 'skip')}
              >
                Skip selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || warnings.length === 0}
                onClick={() => onResolveBatch(warnings.map((warning) => warning.id), 'skip')}
              >
                Skip all
              </Button>
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending same-identity duplicates.</p>
          ) : (
            warnings.map((warning) => {
              const conflicts = warning.conflictingEntryIds
                .map((id) => entries.find((entry) => entry.id === id))
                .filter((entry): entry is CatalogEntry => Boolean(entry))
              const familyName = (names[warning.id] ?? '').trim()
              const switchAvailable = canSwitchToConflicts(warning.format, conflicts)
              const sameBytes = isSameByteDuplicateWarning(warning, entries)
              const naming = installAsId === warning.id
              const incomingName = warning.familyName || fileName(warning.path)
              const version = warning.incomingVersion ? versionText(warning.incomingVersion) : ''
              return (
                <div key={warning.id} className="space-y-3 rounded-lg border px-3 py-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(warning.id)}
                      disabled={busy}
                      onChange={() => toggle(warning.id)}
                      aria-label={`Select ${incomingName}`}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      {conflicts.length === 0 ? (
                        <div>
                          <div className="text-[11px] font-medium text-muted-foreground">Installed now</div>
                          <div className="text-sm text-muted-foreground">No longer in the library</div>
                        </div>
                      ) : (
                        conflicts.map((entry) => (
                          <div key={entry.id} className="rounded-md bg-muted/50 px-2 py-1.5">
                            <div className="text-[11px] font-medium text-muted-foreground">
                              {installedRole(entry)}
                            </div>
                            <div className="text-sm font-medium">
                              {installedTitle(entry)} · {entry.format.toUpperCase()}
                            </div>
                            <div
                              className="truncate font-mono text-[11px] text-muted-foreground"
                              title={entry.sourcePath}
                            >
                              {entry.sourcePath}
                            </div>
                          </div>
                        ))
                      )}
                      <div className="px-2 py-1.5">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <div className="text-[11px] font-medium text-muted-foreground">Incoming</div>
                          {sameBytes ? (
                            <span className="text-[11px] text-muted-foreground">Same bytes</span>
                          ) : null}
                        </div>
                        <div className="text-sm font-medium">
                          {incomingName}
                          {warning.format ? ` · ${warning.format.toUpperCase()}` : ''}
                        </div>
                        {version ? (
                          <div className="text-xs text-muted-foreground">{version}</div>
                        ) : null}
                        <div
                          className="truncate font-mono text-[11px] text-muted-foreground"
                          title={warning.path}
                        >
                          {warning.path}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
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
                      disabled={busy}
                      aria-expanded={naming}
                      onClick={() => setInstallAsId(naming ? null : warning.id)}
                    >
                      Install as…
                    </Button>
                    {switchAvailable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onResolve(warning.id, 'switch')}
                      >
                        Switch
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onResolve(warning.id, 'skip')}
                    >
                      Skip
                    </Button>
                  </div>
                  {naming ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium" htmlFor={`duplicate-name-${warning.id}`}>
                        Family name
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id={`duplicate-name-${warning.id}`}
                          value={names[warning.id] ?? ''}
                          placeholder="A separate family name"
                          disabled={busy}
                          autoFocus
                          onChange={(event) =>
                            setNames((current) => ({ ...current, [warning.id]: event.target.value }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') submitInstallAs(warning.id)
                            if (event.key === 'Escape') setInstallAsId(null)
                          }}
                        />
                        {familyName ? (
                          <Button size="sm" disabled={busy} onClick={() => submitInstallAs(warning.id)}>
                            Install
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setInstallAsId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={resetAndClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
