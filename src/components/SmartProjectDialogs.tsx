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
import { cn } from '@/lib/utils'
import { familyTagRulePredicate, type FamilyTag, type FamilyTagCatalog } from '../../shared/family-tags.ts'
import {
  SMART_MATCH_LABELS,
  SMART_RULE_CHIP_VALUES,
  SMART_RULE_FIELD_OPTIONS,
  SMART_RULE_OPERATOR_LABELS,
  createSmartRule,
  matchingSmartFamilyCount,
  normalizeSmartRuleSet,
  operatorsForField,
  type SmartChipField,
  type SmartMatchEntry,
  type SmartRule,
  type SmartRuleField,
  type SmartRuleOperator,
  type SmartRuleSet,
} from '../../shared/smart-projects.ts'
import { FONT_CLASSIFICATION_LABELS, FONT_CLASSIFICATIONS } from '../../shared/font-classification.ts'

const selectClass =
  'h-8 min-w-0 rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30'

const EMPTY_TAG_CATALOG: FamilyTagCatalog = { tags: [], familyTags: [] }

export function NewProjectDialog({
  open,
  initialName,
  seedCount,
  onCancel,
  onCreate,
}: {
  open: boolean
  initialName: string
  seedCount: number
  onCancel: () => void
  onCreate: (input: { name: string; kind: 'manual' | 'smart' }) => void
}) {
  function submit(name: string, kind: 'manual' | 'smart') {
    onCreate({ name: name.trim() || initialName || 'Untitled project', kind })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A manual project is a fixed set you drop fonts into. A smart project stays live from rules.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <NewProjectForm
            key={`${initialName}:${seedCount}`}
            initialName={initialName}
            seedCount={seedCount}
            onCancel={onCancel}
            onSubmit={submit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function NewProjectForm({
  initialName,
  seedCount,
  onCancel,
  onSubmit,
}: {
  initialName: string
  seedCount: number
  onCancel: () => void
  onSubmit: (name: string, kind: 'manual' | 'smart') => void
}) {
  const [name, setName] = useState(initialName)
  const [kind, setKind] = useState<'manual' | 'smart'>('manual')

  return (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit(name.trim() || initialName || 'Untitled project', kind)
          }}
        >
          <Input
            aria-label="Project name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <KindChoice
              pressed={kind === 'manual'}
              title="Manual"
              detail="Drop fonts in, pin a revision, then activate."
              onClick={() => setKind('manual')}
            />
            <KindChoice
              pressed={kind === 'smart'}
              title="Smart"
              detail="Match status, type, source, folder, or text."
              onClick={() => setKind('smart')}
            />
          </div>
          {kind === 'manual' && seedCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Starts with {seedCount} selected {seedCount === 1 ? 'font' : 'fonts'}.
            </p>
          ) : null}
          {kind === 'smart' ? (
            <p className="text-xs text-muted-foreground">
              You will set the rules next. Membership updates as the library changes.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">{kind === 'smart' ? 'Continue' : 'Create project'}</Button>
          </div>
        </form>
  )
}

function KindChoice({
  pressed,
  title,
  detail,
  onClick,
}: {
  pressed: boolean
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'rounded-md border px-3 py-2 text-left',
        pressed ? 'border-foreground bg-muted' : 'hover:bg-muted/60',
      )}
      onClick={onClick}
    >
      <span className="block text-[13px] font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
    </button>
  )
}

export function SmartRuleEditor({
  open,
  mode = 'edit',
  projectId,
  projectName,
  rules,
  entries,
  folders,
  tags,
  onCancel,
  onSubmit,
  onSnapshot,
}: {
  open: boolean
  mode?: 'create' | 'edit'
  projectId: string | null
  projectName: string
  rules: SmartRuleSet
  entries: SmartMatchEntry[]
  folders: { id: string; label: string }[]
  tags?: FamilyTagCatalog
  onCancel: () => void
  onSubmit: (input: { name: string; rules: SmartRuleSet }) => void
  onSnapshot?: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="w-[min(92vw,640px)]">
        {open ? (
          <SmartRuleForm
            key={`${mode}:${projectId ?? 'smart'}:${projectName}`}
            mode={mode}
            projectName={projectName}
            rules={rules}
            entries={entries}
            folders={folders}
            tags={tags}
            onCancel={onCancel}
            onSubmit={onSubmit}
            onSnapshot={onSnapshot}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>Rules</DialogTitle>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SmartRuleForm({
  mode,
  projectName,
  rules,
  entries,
  folders,
  tags,
  onCancel,
  onSubmit,
  onSnapshot,
}: {
  mode: 'create' | 'edit'
  projectName: string
  rules: SmartRuleSet
  entries: SmartMatchEntry[]
  folders: { id: string; label: string }[]
  tags?: FamilyTagCatalog
  onCancel: () => void
  onSubmit: (input: { name: string; rules: SmartRuleSet }) => void
  onSnapshot?: () => void
}) {
  const [name, setName] = useState(projectName)
  const [draft, setDraft] = useState<SmartRuleSet>(() => normalizeSmartRuleSet(rules))
  const tagCatalog = tags ?? EMPTY_TAG_CATALOG
  const matchOptions = useMemo(
    () => ({ predicates: { tag: familyTagRulePredicate(tagCatalog) } }),
    [tagCatalog],
  )

  const matchCount = useMemo(
    () => matchingSmartFamilyCount(entries, draft, matchOptions),
    [entries, draft, matchOptions],
  )

  function updateRule(id: string, next: SmartRule) {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? next : rule)),
    }))
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New smart project' : 'Edit smart project'}</DialogTitle>
          <DialogDescription>
            Families stay in this project while they match. An empty rule list matches nothing.
          </DialogDescription>
        </DialogHeader>
        <label className="mb-3 block space-y-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input aria-label="Name" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="mb-3 flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Match</span>
          <select
            aria-label="Match"
            className={cn(selectClass, 'flex-1')}
            value={draft.match}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                match: event.target.value === 'any' ? 'any' : 'all',
              }))
            }
          >
            <option value="all">{SMART_MATCH_LABELS.all}</option>
            <option value="any">{SMART_MATCH_LABELS.any}</option>
          </select>
        </label>
        <p className="mb-2 text-xs text-muted-foreground">Rules</p>
        <div className="mb-3 max-h-72 space-y-2 overflow-y-auto">
          {draft.rules.length === 0 ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Add a rule. Until you do, this project is empty.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    rules: [...current.rules, createSmartRule()],
                  }))
                }
              >
                Add rule
              </Button>
            </div>
          ) : (
            draft.rules.map((rule, index) => (
              <RuleRow
                key={rule.id}
                index={index}
                rule={rule}
                folders={folders}
                tags={tagCatalog.tags ?? []}
                onChange={(next) => updateRule(rule.id, next)}
                onRemove={() =>
                  setDraft((current) => ({
                    ...current,
                    rules: current.rules.filter((item) => item.id !== rule.id),
                  }))
                }
                onAdd={() =>
                  setDraft((current) => {
                    const next = [...current.rules]
                    next.splice(index + 1, 0, createSmartRule())
                    return { ...current, rules: next }
                  })
                }
              />
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {matchCount} {matchCount === 1 ? 'family matches' : 'families match'}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {mode === 'edit' && onSnapshot ? (
              <Button type="button" variant="outline" onClick={onSnapshot}>
                Save snapshot as manual project
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                onSubmit({
                  name: name.trim() || projectName || 'Untitled project',
                  rules: normalizeSmartRuleSet(draft),
                })
              }
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </div>
        </div>
    </>
  )
}

function RuleRow({
  index,
  rule,
  folders,
  tags,
  onChange,
  onRemove,
  onAdd,
}: {
  index: number
  rule: SmartRule
  folders: { id: string; label: string }[]
  tags: readonly FamilyTag[]
  onChange: (rule: SmartRule) => void
  onRemove: () => void
  onAdd: () => void
}) {
  const operators = operatorsForField(rule.field)
  const chips = SMART_RULE_CHIP_VALUES[rule.field as SmartChipField]
  const knownTag = tags.some((tag) => tag.id === rule.value)
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={`Rule ${index + 1}`}>
      <select
        aria-label={`Rule ${index + 1} field`}
        className={cn(selectClass, 'w-[8.5rem]')}
        value={rule.field}
        onChange={(event) => {
          const field = event.target.value as SmartRuleField
          const next = createSmartRule({ id: rule.id, field })
          if (field === 'folder') next.value = folders[0]?.id ?? ''
          if (field === 'tag') next.value = tags[0]?.id ?? ''
          if (field === 'classification') next.value = 'serif'
          if (field === 'styleCount') next.value = '1'
          onChange(next)
        }}
      >
        {SMART_RULE_FIELD_OPTIONS.map((option) => (
          <option key={option.field} value={option.field}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`Rule ${index + 1} operator`}
        className={cn(selectClass, 'w-[9.5rem]')}
        value={rule.operator}
        onChange={(event) =>
          onChange({ ...rule, operator: event.target.value as SmartRuleOperator })
        }
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {SMART_RULE_OPERATOR_LABELS[operator]}
          </option>
        ))}
      </select>
      {rule.field === 'styleCount' ? (
        <Input
          aria-label={`Rule ${index + 1} value`}
          type="number"
          min={0}
          step={1}
          value={rule.value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        />
      ) : rule.field === 'classification' ? (
        <select
          aria-label={`Rule ${index + 1} value`}
          className={cn(selectClass, 'min-w-0 flex-1')}
          value={rule.value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        >
          {FONT_CLASSIFICATIONS.map((id) => (
            <option key={id} value={id}>
              {FONT_CLASSIFICATION_LABELS[id]}
            </option>
          ))}
        </select>
      ) : rule.field === 'query' ? (
        <Input
          aria-label={`Rule ${index + 1} text`}
          value={rule.value}
          placeholder="Family or style"
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        />
      ) : rule.field === 'tag' ? (
        <select
          aria-label={`Rule ${index + 1} tag`}
          className={cn(selectClass, 'min-w-0 flex-1')}
          value={rule.value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        >
          {tags.length === 0 ? <option value="">No tags yet</option> : null}
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
          {rule.value && !knownTag ? <option value={rule.value}>{rule.value}</option> : null}
        </select>
      ) : rule.field === 'folder' ? (
        <select
          aria-label={`Rule ${index + 1} folder`}
          className={cn(selectClass, 'min-w-0 flex-1')}
          value={rule.value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        >
          {folders.length === 0 ? <option value="">No watch or retail folder</option> : null}
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.label}
            </option>
          ))}
        </select>
      ) : (
        <select
          aria-label={`Rule ${index + 1} value`}
          className={cn(selectClass, 'min-w-0 flex-1')}
          value={rule.value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        >
          {(chips ?? []).map((chip) => (
            <option key={chip.value} value={chip.value}>
              {chip.label}
            </option>
          ))}
        </select>
      )}
      <Button type="button" variant="ghost" size="sm" aria-label={`Remove rule ${index + 1}`} onClick={onRemove}>
        Remove
      </Button>
      <Button type="button" variant="ghost" size="sm" aria-label={`Add rule after ${index + 1}`} onClick={onAdd}>
        Add
      </Button>
    </div>
  )
}

export function SmartProjectBar({
  summary,
  count,
  active,
  onEdit,
  onSnapshot,
}: {
  summary: string
  count: number
  active: boolean
  onEdit: () => void
  onSnapshot: () => void
}) {
  return (
    <div className="app-region-no-drag flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        Smart project · {summary} · {count} {count === 1 ? 'family' : 'families'}
        {active ? ' · active' : ''}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onEdit}>
        Edit rules
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onSnapshot}>
        Save snapshot as manual project
      </Button>
    </div>
  )
}
