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
import {
  SMART_RULE_CHIP_VALUES,
  SMART_RULE_FIELD_OPTIONS,
  SMART_RULE_OPERATOR_LABELS,
  createSmartRule,
  entryMatchesSmartRules,
  normalizeSmartRuleSet,
  operatorsForField,
  smartRuleSummary,
  type SmartChipField,
  type SmartMatchEntry,
  type SmartRule,
  type SmartRuleField,
  type SmartRuleOperator,
  type SmartRuleSet,
} from '../../shared/smart-projects.ts'

const selectClass =
  'h-8 min-w-0 rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30'

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
            <Button type="submit">Create project</Button>
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
  projectId,
  projectName,
  rules,
  entries,
  folders,
  onCancel,
  onSave,
  onSnapshot,
}: {
  open: boolean
  projectId: string | null
  projectName: string
  rules: SmartRuleSet
  entries: SmartMatchEntry[]
  folders: { id: string; label: string }[]
  onCancel: () => void
  onSave: (rules: SmartRuleSet) => void
  onSnapshot?: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="w-[min(92vw,560px)]">
        {open ? (
          <SmartRuleForm
            key={projectId ?? 'smart'}
            projectName={projectName}
            rules={rules}
            entries={entries}
            folders={folders}
            onCancel={onCancel}
            onSave={onSave}
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
  projectName,
  rules,
  entries,
  folders,
  onCancel,
  onSave,
  onSnapshot,
}: {
  projectName: string
  rules: SmartRuleSet
  entries: SmartMatchEntry[]
  folders: { id: string; label: string }[]
  onCancel: () => void
  onSave: (rules: SmartRuleSet) => void
  onSnapshot?: () => void
}) {
  const [draft, setDraft] = useState<SmartRuleSet>(() => normalizeSmartRuleSet(rules))

  const matchCount = useMemo(
    () => entries.filter((entry) => entryMatchesSmartRules(entry, draft)).length,
    [entries, draft],
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
          <DialogTitle>Rules for {projectName}</DialogTitle>
          <DialogDescription>
            Same fields as the library filters. {smartRuleSummary(draft)}. {matchCount}{' '}
            {matchCount === 1 ? 'font matches' : 'fonts match'} right now.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={draft.match === 'all' ? 'default' : 'outline'}
            aria-pressed={draft.match === 'all'}
            onClick={() => setDraft((current) => ({ ...current, match: 'all' }))}
          >
            Match all
          </Button>
          <Button
            type="button"
            size="sm"
            variant={draft.match === 'any' ? 'default' : 'outline'}
            aria-pressed={draft.match === 'any'}
            onClick={() => setDraft((current) => ({ ...current, match: 'any' }))}
          >
            Match any
          </Button>
        </div>
        <div className="mb-3 max-h-72 space-y-2 overflow-y-auto">
          {draft.rules.every((rule) => rule.field === 'tag') ? (
            <p className="text-sm text-muted-foreground">Add a rule. Until you do, this project is empty.</p>
          ) : (
            draft.rules.map((rule, index) => rule.field === 'tag' ? null : (
              <RuleRow
                key={rule.id}
                index={index}
                rule={rule}
                folders={folders}
                onChange={(next) => updateRule(rule.id, next)}
                onRemove={() =>
                  setDraft((current) => ({
                    ...current,
                    rules: current.rules.filter((item) => item.id !== rule.id),
                  }))
                }
              />
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
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
          <div className="flex gap-2">
            {onSnapshot ? (
              <Button type="button" variant="outline" onClick={onSnapshot}>
                Save snapshot as manual project
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={() => onSave(normalizeSmartRuleSet(draft))}>
              Save rules
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
  onChange,
  onRemove,
}: {
  index: number
  rule: SmartRule
  folders: { id: string; label: string }[]
  onChange: (rule: SmartRule) => void
  onRemove: () => void
}) {
  const operators = operatorsForField(rule.field)
  const chips = SMART_RULE_CHIP_VALUES[rule.field as SmartChipField]
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={`Rule ${index + 1}`}>
      <select
        aria-label={`Rule ${index + 1} field`}
        className={cn(selectClass, 'w-[8.5rem]')}
        value={rule.field}
        onChange={(event) => {
          const field = event.target.value as Exclude<SmartRuleField, 'tag'>
          const next = createSmartRule({ id: rule.id, field })
          if (field === 'folder') next.value = folders[0]?.id ?? ''
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
      {rule.field === 'query' ? (
        <Input
          aria-label={`Rule ${index + 1} text`}
          value={rule.value}
          placeholder="Family or style"
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        />
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
        Smart project · {summary} · {count} {count === 1 ? 'font' : 'fonts'}
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
