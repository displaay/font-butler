import { FolderOpen } from 'lucide-react'
import { AaPreview } from '@/components/AaPreview'
import { catalogFontFamily, systemFontFamily } from '@/components/FontFaceStyles'
import { Button } from '@/components/ui/button'
import { formatBytes, formatRelativeTime } from '@/lib/utils'
import { familyNameOf } from '@/lib/group'
import type { CatalogEntry, FamilyGroup, SystemFamilyGroup } from '@/lib/types'
import { cn } from '@/lib/utils'

const SAMPLE = 'The quick brown fox jumps over the lazy type.'

export function Inspector({
  group,
  entry,
  statusSummary,
  selectedEntryId,
  onSelectEntry,
  systemGroup,
  busy,
  onInstall,
  onInstallAs,
  onReinstall,
  onUninstall,
  onDeactivate,
  onActivate,
  onReveal,
  onUninstallSystem,
  onDeactivateSystem,
  onRevealSystem,
  onForget,
}: {
  group: FamilyGroup | null
  entry: CatalogEntry | null
  statusSummary: string | null
  selectedEntryId: string | null
  onSelectEntry: (entryId: string) => void
  systemGroup: SystemFamilyGroup | null
  busy: boolean
  onInstall: () => void
  onInstallAs: () => void
  onReinstall: () => void
  onUninstall: () => void
  onDeactivate: () => void
  onActivate: () => void
  onReveal: (which: 'source' | 'installed') => void
  onUninstallSystem: () => void
  onDeactivateSystem: () => void
  onRevealSystem: () => void
  onForget: () => void
}) {
  if (systemGroup) {
    const face = systemGroup.faces[0]
    return (
      <aside className="flex w-full flex-col gap-4 p-5 md:w-80">
        <div
          className="rounded-xl bg-white px-4 py-6 text-3xl leading-tight"
          style={{ fontFamily: `"${face ? systemFontFamily(face.path) : ''}", ui-sans-serif` }}
        >
          {SAMPLE}
        </div>
        <div>
          <h2 className="font-sans text-2xl tracking-tight">{systemGroup.familyName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {systemGroup.instanceCount} {systemGroup.instanceCount === 1 ? 'instance' : 'instances'}
            {systemGroup.protected ? ' · system font' : ''}
          </p>
        </div>
        <ul className="space-y-1 text-sm">
          {systemGroup.faces.map((item) => (
            <li key={`${item.path}-${item.styleName}`} className="flex justify-between gap-3">
              <span>{item.styleName}</span>
              <span className="truncate text-muted-foreground">{item.postscriptName}</span>
            </li>
          ))}
        </ul>
        <p className="break-all text-xs text-muted-foreground">{face?.path}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRevealSystem}>
            <FolderOpen /> Show in Finder
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!systemGroup.writable || busy}
            onClick={onDeactivateSystem}
          >
            Deactivate
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!systemGroup.writable || busy}
            onClick={onUninstallSystem}
          >
            Uninstall
          </Button>
        </div>
        {!systemGroup.writable && (
          <p className="text-xs text-muted-foreground">
            Protected fonts stay on the Mac. Fontcase can only remove fonts you installed.
          </p>
        )}
      </aside>
    )
  }

  if (!group || !entry) {
    return (
      <aside className="flex w-full items-center justify-center p-8 text-sm text-muted-foreground md:w-80">
        Select a family to inspect it.
      </aside>
    )
  }

  const previewFace =
    entry.faces.find((face) => /regular|roman|book/i.test(face.styleName)) ?? entry.faces[0]
  const installed = entry.status === 'installed' || entry.status === 'outdated'
  const showReinstall = group.entries.some((item) => item.status === 'outdated')

  return (
    <aside className="flex w-full flex-col gap-4 p-5 md:w-80">
      <div
        className="rounded-xl bg-white px-4 py-6 text-3xl leading-tight"
        style={{
          fontFamily: `"${catalogFontFamily(entry.id)}", ui-sans-serif`,
          fontWeight: previewFace?.weight,
          fontStyle: previewFace?.italic ? 'italic' : 'normal',
        }}
      >
        {SAMPLE}
      </div>
      <div>
        <h2 className="font-sans text-2xl tracking-tight">{familyNameOf(entry)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {group.instanceCount} {group.instanceCount === 1 ? 'instance' : 'instances'}
          {group.isVariable ? ' · variable' : ''}
          {group.entries.length > 1 ? ` · ${group.entries.length} files` : ''}
          {statusSummary ? ` · ${statusSummary}` : ''}
        </p>
      </div>
      {entry.status === 'outdated' && (
        <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Source changed. Reinstall to use the new file.
        </div>
      )}
      {entry.status === 'source-missing' && (
        <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900">
          The source file is missing. Remove this entry if you no longer need it.
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Source</dt>
        <dd className="truncate" title={entry.sourcePath}>
          {entry.sourcePath}
        </dd>
        <dt className="text-muted-foreground">Modified</dt>
        <dd>{formatRelativeTime(entry.sourceMtimeMs)}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd>{formatBytes(entry.sourceSize)}</dd>
        <dt className="text-muted-foreground">Format</dt>
        <dd className="uppercase">{entry.format}</dd>
      </dl>
      <div className="space-y-2">
        {group.entries.map((item) => {
          const selected = item.id === selectedEntryId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectEntry(item.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/80',
                selected && 'bg-muted ring-1 ring-primary/30',
              )}
            >
              <AaPreview
                family={catalogFontFamily(item.id)}
                weight={item.faces[0]?.weight}
                italic={item.faces[0]?.italic}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {item.faces.map((face) => face.styleName).join(', ')}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.faces[0]?.postscriptName}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {entry.status === 'source-missing' ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={onForget}>
            Remove from library
          </Button>
        ) : installed ? (
          <>
            {showReinstall && (
              <Button size="sm" variant="accent" disabled={busy} onClick={onReinstall}>
                Reinstall
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={onDeactivate}>
              Deactivate
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={onUninstall}>
              Uninstall
            </Button>
          </>
        ) : entry.status === 'deactivated' ? (
          <Button size="sm" disabled={busy} onClick={onActivate}>
            Activate
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={onInstall}>
              Install
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onInstallAs}>
              Install as…
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => onReveal('source')}>
          <FolderOpen /> Show in Finder
        </Button>
      </div>
    </aside>
  )
}
