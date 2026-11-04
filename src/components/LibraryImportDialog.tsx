import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import type {
  LibraryImportApplyResult,
  LibraryImportFileInput,
  LibraryImportPlan,
  LibraryImportSetChoice,
  LibraryImportSetPlan,
} from '../../shared/library-import.ts'

async function readImportFile(file: File): Promise<LibraryImportFileInput> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const magic = String.fromCharCode(...bytes.subarray(0, 15))
  const binary =
    magic.startsWith('bplist') ||
    magic.startsWith('SQLite format 3') ||
    magic.startsWith('PK') ||
    /\.(fexdb|fexbackup|db)$/i.test(file.name)
  if (!binary) return { name: file.name, content: new TextDecoder().decode(buffer) }
  let binaryText = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binaryText += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return { name: file.name, content: '', contentBase64: btoa(binaryText) }
}

function choiceOptions(set: LibraryImportSetPlan): { value: LibraryImportSetChoice; label: string }[] {
  if (set.disabled) return []
  if (set.collision) {
    const options: { value: LibraryImportSetChoice; label: string }[] = []
    if (!set.existingIsSmart) options.push({ value: 'merge', label: 'Merge members' })
    options.push({ value: 'skip', label: 'Skip' })
    return options
  }
  return [
    { value: 'create', label: set.kind === 'smart' ? 'Create smart project' : 'Create project' },
    { value: 'skip', label: 'Skip' },
  ]
}

export function LibraryImportPlanView({
  plan,
  choices,
  onChoice,
}: {
  plan: LibraryImportPlan
  choices: Record<string, LibraryImportSetChoice>
  onChoice: (setId: string, choice: LibraryImportSetChoice) => void
}) {
  return (
    <div className="space-y-3" data-library-import-plan>
      <p className="text-sm text-muted-foreground">
        {plan.summary.sets} set{plan.summary.sets === 1 ? '' : 's'} · {plan.summary.smartSets} smart ·{' '}
        {plan.summary.labels} label{plan.summary.labels === 1 ? '' : 's'} ·{' '}
        {plan.summary.unresolvedFonts} unresolved
      </p>
      {plan.sets.map((set) => (
        <section key={set.id} className="rounded-lg border px-3 py-2">
          <h3 className="text-sm font-medium">
            {set.name}
            <span className="ml-2 font-normal text-muted-foreground">
              {set.kind === 'smart' ? 'Smart project' : 'Project'}
            </span>
          </h3>
          {set.collision ? (
            <p className="mt-1 text-xs text-muted-foreground">
              A project with this name already exists; its members will be merged in.
            </p>
          ) : null}
          {set.isBuiltIn ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Font Book built-in collection; starts unchecked.
            </p>
          ) : null}
          {set.disabled ? (
            <p className="mt-1 text-xs text-muted-foreground" data-library-import-disabled>
              Skipped: a rule below cannot be translated, so this smart set is not imported.
            </p>
          ) : null}
          {set.kind === 'manual' && set.untranslatableRules.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {set.memberAssetIds.length} matched
              {set.alreadyMemberAssetIds.length > 0
                ? ` · ${set.alreadyMemberAssetIds.length} already in the project`
                : ''}
              {set.unresolved.length > 0 ? ` · ${set.unresolved.length} unresolved` : ''}
            </p>
          ) : null}
          {set.untranslatableRules.length > 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              <p>These rules have no smart-project equivalent:</p>
              <ul className="mt-1 list-disc pl-4">
                {set.untranslatableRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {set.unresolved.length > 0 ? (
            <ul className="mt-1 text-xs text-muted-foreground">
              {set.unresolved.map((item) => (
                <li key={item.raw}>Unresolved: {item.raw}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {choiceOptions(set).map((option) => {
              const active = (choices[set.id] ?? set.defaultChoice) === option.value
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => onChoice(set.id, option.value)}
                >
                  {option.label}
                </Button>
              )
            })}
          </div>
        </section>
      ))}

      {plan.labels.length > 0 ? (
        <section className="rounded-lg border px-3 py-2">
          <h3 className="text-[13px] font-medium">Labels → family tags</h3>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {plan.labels.map((label) => (
              <li key={label.id}>
                {label.name}:{' '}
                {label.skipReason
                  ? label.skipReason
                  : `${label.existingTagId ? 'reuse existing tag' : 'new tag'} · ${label.familyKeys.length} famil${label.familyKeys.length === 1 ? 'y' : 'ies'}`}
                {label.unresolvedCount > 0 ? ` · ${label.unresolvedCount} unresolved` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.unsupported.length > 0 ? (
        <section className="rounded-lg border px-3 py-2" data-library-import-unsupported>
          <h3 className="text-[13px] font-medium">Not imported</h3>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {plan.unsupported.map((item, index) => (
              <li key={`${item.concept}-${index}`}>
                {item.concept}: {item.reason}
                {item.count !== undefined
                  ? item.count === null
                    ? ' Count could not be read.'
                    : ` (${item.count})`
                  : ''}
                {item.detail ? ` ${item.detail}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.warnings.map((warning) => (
        <p key={warning} className="text-xs text-muted-foreground">
          {warning}
        </p>
      ))}
    </div>
  )
}

export function LibraryImportDialog({
  open,
  onClose,
  onApplied,
  planFiles,
  applyPlan,
}: {
  open: boolean
  onClose: () => void
  onApplied?: (result: LibraryImportApplyResult) => void
  planFiles?: (files: LibraryImportFileInput[]) => Promise<LibraryImportPlan>
  applyPlan?: (
    plan: LibraryImportPlan,
    choices: Record<string, LibraryImportSetChoice>,
  ) => Promise<LibraryImportApplyResult>
}) {
  const [plan, setPlan] = useState<LibraryImportPlan | null>(null)
  const [choices, setChoices] = useState<Record<string, LibraryImportSetChoice>>({})
  const [result, setResult] = useState<LibraryImportApplyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function pickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setBusy(true)
    setError('')
    try {
      const files = await Promise.all(Array.from(fileList).map(readImportFile))
      const next = planFiles
        ? await planFiles(files)
        : (await api.planLibraryImport(files)).plan
      setPlan(next)
      setChoices(Object.fromEntries(next.sets.map((set) => [set.id, set.defaultChoice])))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that library file.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!plan) return
    setBusy(true)
    setError('')
    try {
      const applied = applyPlan
        ? await applyPlan(plan, choices)
        : (await api.applyLibraryImport(plan, choices)).result
      setResult(applied)
      onApplied?.(applied)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not apply that import.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,720px)] w-[min(94vw,640px)] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import library organisation</DialogTitle>
          <DialogDescription>
            Font Book collections become projects. FontExplorer X files are reported, not guessed.
            Nothing is applied until you confirm.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 overflow-y-auto" data-library-import-result>
            <p className="text-sm">
              Created {result.createdProjects.length} project
              {result.createdProjects.length === 1 ? '' : 's'}
              {result.mergedProjects.length > 0
                ? `, merged ${result.mergedProjects.length}`
                : ''}
              {result.skippedSets.length > 0 ? `, skipped ${result.skippedSets.length}` : ''}.
            </p>
            {result.createdTags.length > 0 ? (
              <p className="text-sm">Tags created: {result.createdTags.join(', ')}</p>
            ) : null}
            {result.reusedTags.length > 0 ? (
              <p className="text-sm">Tags reused: {result.reusedTags.join(', ')}</p>
            ) : null}
            {result.unresolvedFonts > 0 ? (
              <p className="text-sm text-muted-foreground">
                {result.unresolvedFonts} font name{result.unresolvedFonts === 1 ? '' : 's'} stayed
                unresolved on the imported projects.
              </p>
            ) : null}
            <div className="flex justify-end pt-2">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".collection,.plist,.fexdb,.fexbackup,.db"
                className="hidden"
                aria-label="Choose library files"
                onChange={(event) => {
                  void pickFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {plan ? 'Choose different files' : 'Choose library files…'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Pick Font Book `.collection` files from ~/Library/FontCollections, or a FontExplorer
                X database (`FontExplorer X.fexdb`, the `FontDatabase.db` inside a `.fexconfig`
                folder, or a `.fexbackup`). Font files are never copied by this import.
              </p>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>

            {plan ? (
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                <LibraryImportPlanView
                  plan={plan}
                  choices={choices}
                  onChoice={(setId, choice) =>
                    setChoices((current) => ({ ...current, [setId]: choice }))
                  }
                />
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy || !plan} onClick={() => void apply()}>
                Apply import
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
