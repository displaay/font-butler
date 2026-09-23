import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Filter, Loader2, Search } from 'lucide-react'
import { DisplaayMark } from '@/components/DisplaayMark'
import { TrialBadge } from '@/components/Badges'
import { SettingsRow, SettingsSection, settingsSelectClass } from '@/components/SettingsRow'
import { Button } from '@/components/ui/button'
import { Input, PasswordInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { startQueuedFontAction } from '@/lib/actionQueue'
import { RetailDisableDialog } from '@/components/RetailDisableDialog'
import { RetailFamiliesOffDialog } from '@/components/RetailFamiliesOffDialog'
import {
  DEFAULT_RETAIL_AUTOCHECK_MINUTES,
  RETAIL_AUTOCHECK_CHOICES,
  groupRetailFontsByTypeface,
  isRetailVariableFamilyName,
  matchesRetailFontQuery,
  nextDisabledRetailFamilyNames,
  nextDisabledRetailFamilyNamesForScope,
  retailFamilyNamesForSyncScope,
  retailSyncOffersVfCollections,
  retailDriftSummary,
  retailFamiliesOffInstalled,
  retailFamiliesOffNeedsChoice,
  retailSyncInProgress,
  type RetailDisableAction,
  type RetailFontFormat,
  type RetailSkip,
  type RetailSkipReason,
  type RetailSyncFont,
  type RetailSyncScope,
  type RetailSyncStatus,
} from '@/lib/types'
import { cn, CONTROL_H } from '@/lib/utils'

const BLOCKED_KINDS = new Set(['conflict', 'refused'])

function SyncToggle({
  enabled,
  disabled,
  ariaLabel,
  onChange,
}: {
  enabled: boolean
  disabled: boolean
  ariaLabel: string
  onChange: (enabled: boolean) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5"
    >
      {(
        [
          { id: false, label: 'Off' },
          { id: true, label: 'On' },
        ] as const
      ).map((option) => {
        const selected = enabled === option.id
        return (
          <Button
            key={option.label}
            type="button"
            size="sm"
            variant="ghost"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            className={cn(
              'h-7 px-2.5',
              selected ? 'bg-muted font-medium' : 'text-muted-foreground',
            )}
            onClick={() => {
              if (!selected) onChange(option.id)
            }}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

function FormatToggle({
  formats,
  selected,
  disabled,
  ariaLabel,
  onChange,
}: {
  formats: RetailFontFormat[]
  selected: RetailFontFormat
  disabled: boolean
  ariaLabel: string
  onChange: (format: RetailFontFormat) => void
}) {
  if (formats.length < 2) return null
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5"
    >
      {formats.map((format) => {
        const active = selected === format
        return (
          <Button
            key={format}
            type="button"
            size="sm"
            variant="ghost"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={cn(
              'h-7 px-2.5 uppercase',
              active ? 'bg-muted font-medium' : 'text-muted-foreground',
            )}
            onClick={() => {
              if (!active) onChange(format)
            }}
          >
            {format}
          </Button>
        )
      })}
    </div>
  )
}

function nextFamilyFormats(
  fonts: RetailSyncFont[],
  familyName: string,
  format: RetailFontFormat,
): Record<string, RetailFontFormat> {
  const next: Record<string, RetailFontFormat> = {}
  for (const font of fonts) {
    if (font.formats.length < 2) continue
    next[font.familyName] = font.familyName === familyName ? format : font.selectedFormat
  }
  return next
}

function RetailSyncScopeControl({
  disabled,
  offersVfCollections,
  onSync,
}: {
  disabled: boolean
  offersVfCollections: boolean
  onSync: (scope: RetailSyncScope) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const segment = 'h-7 px-2 text-xs font-medium hover:bg-muted disabled:opacity-50'
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Sync">
      <span className="text-[13px] text-muted-foreground">Sync</span>
      <div className="flex items-stretch rounded-md border bg-background">
        <button type="button" className={segment} disabled={disabled} onClick={() => onSync('all')}>
          All
        </button>
        <div className="relative border-l" ref={menuRef}>
          <button
            type="button"
            className={cn(segment, 'flex items-center gap-0.5', menuOpen && 'bg-muted')}
            disabled={disabled}
            aria-haspopup={offersVfCollections ? 'menu' : undefined}
            aria-expanded={offersVfCollections ? menuOpen : undefined}
            aria-label="Sync variable fonts"
            onClick={() => {
              if (!offersVfCollections) {
                onSync('vf-all')
                return
              }
              setMenuOpen((open) => !open)
            }}
          >
            VF
            {offersVfCollections ? <ChevronDown className="size-3 text-muted-foreground" aria-hidden /> : null}
          </button>
          {offersVfCollections && menuOpen ? (
            <div
              role="menu"
              className="absolute top-full right-0 z-30 mt-1 min-w-52 rounded-md border bg-popover p-1 shadow-sm"
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false)
                  onSync('vf-collections')
                }}
              >
                Collections only
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false)
                  onSync('vf-all')
                }}
              >
                All
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={cn(segment, 'border-l')}
          disabled={disabled}
          onClick={() => onSync('static')}
        >
          Static
        </button>
      </div>
    </div>
  )
}

function RetailFontList({
  fonts,
  disabled,
  onToggle,
  onFormat,
  onSyncScope,
  onSetAll,
}: {
  fonts: RetailSyncFont[]
  disabled: boolean
  onToggle: (familyName: string, enabled: boolean) => void
  onFormat: (familyName: string, format: RetailFontFormat) => void
  onSyncScope: (scope: RetailSyncScope) => void
  onSetAll: (enabled: boolean, familyNames: string[]) => void
}) {
  const [showStatic, setShowStatic] = useState(true)
  const [showVariable, setShowVariable] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filterRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const synced = fonts.filter((font) => font.enabled).length
  const kindFiltered = showStatic && showVariable
  const searching = query.trim().length > 0
  const visible = fonts.filter((font) => {
    const variable = isRetailVariableFamilyName(font.familyName)
    if (!(variable ? showVariable : showStatic)) return false
    return matchesRetailFontQuery(font, query)
  })
  const groups = groupRetailFontsByTypeface(visible)
  const visibleSynced = visible.filter((font) => font.enabled).length
  const narrowed = visible.length > 0 && visible.length < fonts.length
  const batchNames = visible.map((font) => font.familyName)

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!filterOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setFilterOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [filterOpen])

  return (
    <div className="rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-[13px] leading-5 text-muted-foreground">
          {narrowed
            ? visibleSynced === visible.length
              ? `${visible.length} matching`
              : `${visibleSynced} of ${visible.length} matching`
            : synced === 0
              ? `${fonts.length} ${fonts.length === 1 ? 'family' : 'families'} listed`
              : synced === fonts.length
                ? `${fonts.length} ${fonts.length === 1 ? 'family' : 'families'} syncing`
                : `${synced} of ${fonts.length} families syncing`}
        </p>
        <div className="flex min-w-0 items-center gap-1">
          {searchOpen ? (
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.stopPropagation()
                setSearchOpen(false)
              }}
              placeholder="Search"
              aria-label="Search families"
              autoFocus
              className="h-7 w-36 shrink-0 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
            />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(CONTROL_H, 'w-8 px-0', (searchOpen || searching) && 'bg-muted')}
            aria-label="Search families"
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="size-3.5 text-muted-foreground" />
          </Button>
          <div className="relative" ref={filterRef}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(CONTROL_H, 'w-8 px-0', (filterOpen || !kindFiltered) && 'bg-muted')}
              aria-label="Filter families"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <Filter className="size-3.5 text-muted-foreground" />
            </Button>
            {filterOpen ? (
              <div
                role="menu"
                className="absolute top-full right-0 z-30 mt-1 min-w-44 rounded-md border bg-popover p-1 shadow-sm"
              >
                {(
                  [
                    { id: 'static', label: 'Static fonts', checked: showStatic, onChange: setShowStatic },
                    { id: 'variable', label: 'Variable fonts', checked: showVariable, onChange: setShowVariable },
                  ] as const
                ).map((option) => (
                  <Label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-normal text-foreground hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={option.checked}
                      onChange={(event) => option.onChange(event.target.checked)}
                      className="size-3.5 rounded border border-input accent-primary"
                    />
                    {option.label}
                  </Label>
                ))}
              </div>
            ) : null}
          </div>
          <RetailSyncScopeControl
            disabled={disabled || fonts.length === 0}
            offersVfCollections={retailSyncOffersVfCollections(fonts)}
            onSync={onSyncScope}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={visibleSynced === 0}
            onClick={() => onSetAll(false, batchNames)}
          >
            {narrowed ? 'Off these' : 'None'}
          </Button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-3 py-3 text-[13px] leading-5 text-muted-foreground">
            {searching
              ? 'No families match this search.'
              : !showVariable && showStatic
                ? 'No static fonts.'
                : showVariable && !showStatic
                  ? 'No variable fonts.'
                  : 'No families match this filter.'}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.typefaceName} className="border-b last:border-b-0">
              <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {group.typefaceName}
              </div>
              {group.fonts.map((font) => (
                <div key={font.familyName} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium leading-5">{font.familyName}</div>
                    <p className="text-[13px] leading-5 text-muted-foreground">
                      {font.available === false
                        ? 'Not available yet'
                        : font.fileCount === 1
                          ? '1 file'
                          : `${font.fileCount} files`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <FormatToggle
                      formats={font.formats}
                      selected={font.selectedFormat}
                      disabled={disabled}
                      ariaLabel={`Format for ${font.familyName}`}
                      onChange={(format) => onFormat(font.familyName, format)}
                    />
                    <SyncToggle
                      enabled={font.enabled}
                      disabled={disabled}
                      ariaLabel={`Sync ${font.familyName}`}
                      onChange={(next) => onToggle(font.familyName, next)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function skipName(skip: RetailSkip): string {
  return skip.typefaceName?.trim() || skip.glyphsFile?.trim() || 'Family'
}

function skipLabel(reason: RetailSkipReason): string {
  switch (reason) {
    case 'regenerating':
      return 'being regenerated right now'
    case 'no-active-revision':
      return 'has no active revision'
    case 'no-transaction':
      return 'has never been generated'
    case 'transaction-not-succeeded':
      return 'last generation did not finish'
    case 'incomplete':
      return 'has no files on the worker yet'
    case 'no-files':
      return 'has no desktop fonts'
    default:
      return 'could not be read'
  }
}

/**
 * The optional Displaay retail collection.
 *
 * Opening this pane loads the font list from the worker. Syncing stays an explicit action so a slow
 * worker can't download fonts until the user asks.
 */
export function RetailPane({
  status,
  familiesOnMac,
  busy,
  onStatus,
  onSync,
  onRequestDisable,
}: {
  status: RetailSyncStatus | null
  /** Retail families with fonts installed or deactivated on this Mac. */
  familiesOnMac?: ReadonlySet<string>
  busy: boolean
  onStatus: (status: RetailSyncStatus) => void
  onSync?: () => void
  onRequestDisable?: () => void
}) {
  const urlId = useId()
  const tokenId = useId()
  const autoCheckId = useId()
  const advancedId = useId()
  const [token, setToken] = useState('')
  // Session-only: Advanced reveals the worker address and token rows. Nothing is persisted.
  const [advanced, setAdvanced] = useState(false)
  // `status` is null on the first render, so the field cannot be seeded from it directly — an edited
  // value wins, otherwise fall back to whatever the server reports.
  const [editedUrl, setEditedUrl] = useState<string | null>(null)
  const workerBaseUrl = editedUrl ?? status?.workerBaseUrl ?? ''
  const [error, setError] = useState<string | null>(null)
  const [disableOpen, setDisableOpen] = useState(false)
  const [turningOff, setTurningOff] = useState<string[] | null>(null)
  const [checking, setChecking] = useState(
    () => Boolean(status?.enabled) && (status?.fonts.length ?? 0) === 0 && !status?.checkedAt,
  )
  const autoCheckStartedRef = useRef(false)

  const disabled = busy
  const loadedRef = useRef(false)
  const enabled = Boolean(status?.enabled)

  // `/api/retail/status` reads settings and the local manifest only — no network — so it is safe on
  // first render. Opening the pane then checks the worker for the font list.
  useEffect(() => {
    if (status || loadedRef.current) return
    loadedRef.current = true
    void api.retail
      .status()
      .then((result) => onStatus(result.status))
      .catch(() => {
        loadedRef.current = false
      })
  }, [status, onStatus])

  const run = (action: () => Promise<{ status: RetailSyncStatus }>) => {
    setError(null)
    startQueuedFontAction(async () => {
      try {
        onStatus((await action()).status)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong.')
      }
    })
  }

  // The token decides the collection, and `mode` only moves on a check — run one right away so the badge
  // and the switch to the new collection follow the token instead of the next background check.
  const saveToken = (value: string) =>
    run(async () => {
      const result = await api.retail.configure({ token: value })
      if (value) setToken('')
      if (!result.status.enabled) return result
      onStatus(result.status)
      return api.retail.check(true)
    })

  // Font-list changes must reach the server even while a sync HTTP request is still in flight.
  const configureSelection = (input: {
    disabledGlyphsFiles?: string[]
    familyFormats?: Record<string, RetailFontFormat>
    disableAction?: RetailDisableAction
  }) => {
    setError(null)
    return api.retail
      .configure(input)
      .then((result) => {
        onStatus(result.status)
        return result
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Something went wrong.')
        return null
      })
  }

  const startSync = () => {
    if (onSync) onSync()
    else void api.retail.sync().then((result) => onStatus(result.status))
  }

  const blocked = (status?.drift ?? []).filter((item) => BLOCKED_KINDS.has(item.kind))
  const lastError = error ?? status?.error ?? null
  const fonts = status?.fonts ?? []
  const manifestReady = !enabled || Boolean(status?.checkedAt)
  const selectionDisabled = disabled || !manifestReady
  const showFontLoader = (checking || !manifestReady) && fonts.length === 0

  useEffect(() => {
    if (!enabled) {
      autoCheckStartedRef.current = false
      return
    }
    // `checkedAt` is per process: after a restart the list comes from catalog listings, which no longer
    // include families turned off, so check once to list them again.
    if (!status || status.checkedAt) return
    if (autoCheckStartedRef.current) return
    autoCheckStartedRef.current = true
    setChecking(true)
    setError(null)
    startQueuedFontAction(async () => {
      try {
        onStatus((await api.retail.check(true)).status)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong.')
      } finally {
        setChecking(false)
      }
    })
  }, [enabled, status, onStatus])

  const turnSyncOff = (disableAction: RetailDisableAction) => {
    setDisableOpen(false)
    void run(() => api.retail.configure({ enabled: false, disableAction }))
  }

  return (
    <>
    <SettingsSection
      title={
        <>
          <DisplaayMark className="size-4" />
          Displaay retail
        </>
      }
    >
      <SettingsRow
        label="Sync"
        description="Load the Displaay retail list. Fonts stay off the computer until you Sync or turn a family on."
      >
        <SyncToggle
          enabled={enabled}
          disabled={disabled}
          ariaLabel="Displaay retail sync"
          onChange={(next) => {
            if (!next) {
              if (onRequestDisable) onRequestDisable()
              else setDisableOpen(true)
              return
            }
            void run(() => api.retail.configure({ enabled: true }))
          }}
        />
      </SettingsRow>

      {enabled ? (
        <>
      <SettingsRow
        label="Check automatically"
        htmlFor={autoCheckId}
        description="How often to look for newer retail fonts. Checking never runs at startup."
      >
        <select
          id={autoCheckId}
          className={settingsSelectClass}
          value={status?.autoCheckMinutes ?? DEFAULT_RETAIL_AUTOCHECK_MINUTES}
          disabled={disabled}
          onChange={(event) =>
            void run(() => api.retail.configure({ autoCheckMinutes: Number(event.target.value) }))
          }
        >
          {RETAIL_AUTOCHECK_CHOICES.map((choice) => (
            <option key={choice.minutes} value={choice.minutes}>
              {choice.label}
            </option>
          ))}
        </select>
      </SettingsRow>

      <SettingsRow
        label="Advanced"
        htmlFor={advancedId}
        description="Show the worker address and token."
      >
        <input
          id={advancedId}
          type="checkbox"
          checked={advanced}
          onChange={(event) => setAdvanced(event.target.checked)}
          className="size-4 shrink-0 cursor-pointer rounded border border-input accent-primary"
        />
      </SettingsRow>

      {advanced ? (
        <>
          <SettingsRow
            label="Worker address"
            htmlFor={urlId}
            description="The Displaay worker that serves the collection."
          >
            <Input
              id={urlId}
              className="w-[min(18rem,100%)]"
              value={workerBaseUrl}
              disabled={disabled}
              placeholder="https://w.displaay.net"
              onChange={(event) => setEditedUrl(event.target.value)}
              onBlur={() => {
                if (workerBaseUrl && workerBaseUrl !== status?.workerBaseUrl) {
                  void run(async () => {
                    const result = await api.retail.configure({ workerBaseUrl })
                    setEditedUrl(null)
                    return result
                  })
                }
              }}
            />
          </SettingsRow>

          <SettingsRow
            label={
              <span className="inline-flex items-center gap-1.5">
                Worker token
                {status?.mode === 'trial' ? <TrialBadge /> : null}
              </span>
            }
            htmlFor={tokenId}
            description={
              status?.hasToken
                ? status.mode === 'trial'
                  ? 'Your token only unlocks the trial fonts. Replace it with one that has retail access for the full files.'
                  : 'Your token is saved. Remove goes back to the trial fonts and replaces the installed full files with the trials right away.'
                : 'Using the built-in trial access: you get the Displaay trial fonts. Save a token with retail access to replace the trials with the full files.'
            }
          >
            <div className="flex max-w-[min(100%,22rem)] flex-wrap items-center justify-end gap-1.5">
              <PasswordInput
                id={tokenId}
                className="w-44"
                value={token}
                disabled={disabled}
                placeholder={status?.hasToken ? '••••••••' : 'Retail token'}
                onChange={(event) => setToken(event.target.value)}
                onReveal={
                  status?.hasToken
                    ? async () => {
                        if (token) return
                        try {
                          const result = await api.retail.token()
                          setToken(result.token)
                        } catch (caught) {
                          setError(caught instanceof Error ? caught.message : 'Could not read the worker token.')
                        }
                      }
                    : undefined
                }
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || !token}
                onClick={() => saveToken(token)}
              >
                Save
              </Button>
              {status?.hasToken ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  title="Go back to the trial fonts. Installed full files are replaced with the trials."
                  onClick={() => saveToken('')}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        </>
      ) : null}

      <div className="py-3.5">
        <div className="rounded-lg border bg-muted/30 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {showFontLoader ? 'Checking…' : status ? retailDriftSummary(status) : 'Not checked yet.'}
              </div>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                {showFontLoader
                  ? 'Loading the collection…'
                  : status?.checkedAt
                    ? `Last checked ${new Date(status.checkedAt).toLocaleString()}.`
                    : status?.enabled
                      ? 'Check to load the collection and choose which families to sync.'
                      : 'Turn sync on to load the font list. Nothing is downloaded until you Sync or turn a family on.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={disabled || checking || !status?.enabled}
                onClick={() => {
                  setChecking(true)
                  void run(async () => {
                    try {
                      return await api.retail.check(true)
                    } finally {
                      setChecking(false)
                    }
                  })
                }}
              >
                {checking ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                    Checking
                  </>
                ) : (
                  'Check'
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={disabled || !status?.enabled || !status?.pending}
                onClick={() => {
                  if (onSync) {
                    onSync()
                    return
                  }
                  void run(() => api.retail.sync())
                }}
              >
                {status?.pending ? `Sync ${status.pending}` : 'Sync'}
              </Button>
            </div>
          </div>
          {lastError ? (
            <p className="mt-2 text-[13px] leading-5 text-destructive">{lastError}</p>
          ) : null}
          {blocked.length > 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              {blocked.length === 1 ? '1 file needs attention' : `${blocked.length} files need attention`}
              {': '}
              {blocked
                .slice(0, 3)
                .map((item) => item.note ?? item.relativePath)
                .join(' ')}
            </p>
          ) : null}
          {status && status.skipped.length > 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              {status.skipped.length === 1 ? '1 family not available' : `${status.skipped.length} families not available`}
              {' · '}
              {status.skipped
                .slice(0, 4)
                .map((skip) => `${skipName(skip)} ${skipLabel(skip.reason)}`)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      </div>

      {fonts.length > 0 || showFontLoader ? (
        <SettingsRow
          label="Fonts"
          description={
            showFontLoader
              ? 'Loading the collection…'
              : 'Turn a family on to download it, or Sync. When a family has both otf and ttf, only the selected format is downloaded.'
          }
          extra={
            showFontLoader ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-6 text-[13px] leading-5 text-muted-foreground"
              >
                <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                Loading fonts…
              </div>
            ) : (
            <RetailFontList
              fonts={fonts}
              disabled={selectionDisabled}
              onToggle={(familyName, nextEnabled) => {
                if (!manifestReady) return
                void configureSelection({
                  disabledGlyphsFiles: nextDisabledRetailFamilyNames(fonts, [familyName], nextEnabled),
                }).then((result) => {
                  if (result && nextEnabled) startSync()
                })
              }}
              onFormat={(familyName, format) => {
                if (!manifestReady) return
                void configureSelection({
                  familyFormats: nextFamilyFormats(fonts, familyName, format),
                })
              }}
              onSyncScope={(scope) => {
                if (!manifestReady) return
                const selected = retailFamilyNamesForSyncScope(fonts, scope)
                if (selected.length === 0) return
                void configureSelection({
                  disabledGlyphsFiles: nextDisabledRetailFamilyNamesForScope(fonts, scope),
                }).then((result) => {
                  if (result) startSync()
                })
              }}
              onSetAll={(syncEnabled, familyNames) => {
                if (!manifestReady) return
                if (!syncEnabled && retailFamiliesOffNeedsChoice(fonts, familyNames, status, familiesOnMac)) {
                  setTurningOff(familyNames)
                  return
                }
                void configureSelection({
                  disabledGlyphsFiles: nextDisabledRetailFamilyNames(fonts, familyNames, syncEnabled),
                }).then((result) => {
                  if (result && syncEnabled) startSync()
                })
              }}
            />
            )
          }
        />
      ) : null}
        </>
      ) : null}
    </SettingsSection>
    <RetailFamiliesOffDialog
      open={turningOff !== null}
      syncing={retailSyncInProgress(status)}
      installed={retailFamiliesOffInstalled(fonts, turningOff ?? [], familiesOnMac)}
      onDismiss={() => setTurningOff(null)}
      onChoose={(disableAction) => {
        const names = turningOff ?? []
        setTurningOff(null)
        void configureSelection({
          disabledGlyphsFiles: nextDisabledRetailFamilyNames(fonts, names, false),
          disableAction,
        })
      }}
    />
    {onRequestDisable ? null : (
    <RetailDisableDialog
      open={disableOpen}
      busy={disabled}
      onDismiss={() => setDisableOpen(false)}
      onChoose={turnSyncOff}
    />
    )}
    </>
  )
}
