import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { classificationLabel, collectionImportScope, planChoiceLabel } from '@/lib/planner'
import type { ImportPlan, ImportPlanItem } from '@/lib/types'

export function ImportPlanDialog({
  open,
  plan,
  onCancel,
  onConfirm,
}: {
  open: boolean
  plan: ImportPlan | null
  onCancel: () => void
  onConfirm: (
    choices: Record<string, ImportPlanItem['defaultChoice']>,
    familyName?: string,
  ) => void
}) {
  const [choices, setChoices] = useState<Record<string, ImportPlanItem['defaultChoice']>>({})
  const [familyName, setFamilyName] = useState('')

  useEffect(() => {
    if (!open || !plan) return
    const next: Record<string, ImportPlanItem['defaultChoice']> = {}
    for (const item of plan.items) {
      next[item.id] = item.defaultChoice
    }
    setChoices(next)
    setFamilyName('')
  }, [open, plan])

  const summary = plan?.summary
  const reviewItems =
    plan?.items.filter(
      (item) =>
        item.classification === 'alt-format' ||
        item.classification === 'collection-overlap' ||
        item.classification === 'unsupported' ||
        item.classification === 'revision',
    ) ?? []
  const installAsSelected = reviewItems.some((item) => choices[item.id] === 'install-as')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,720px)] w-[min(94vw,640px)] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Review incoming fonts</DialogTitle>
          <DialogDescription>
            {summary
              ? `${summary.add} add · ${summary.install} install · ${summary.unchanged} unchanged · ${summary.review} need a decision · ${summary.preview} preview-only`
              : 'Choose what to do with conflicting files. Unique fonts in this drop are kept.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {reviewItems.map((item) => {
            const scope = collectionImportScope(item)
            return (
            <div key={item.id} className="rounded-lg border px-3 py-2">
              <div className="text-sm font-medium">{item.familyName || item.path.split('/').pop()}</div>
              <div className="text-xs text-muted-foreground">
                {classificationLabel(item)}
                {item.currentFormat && item.format
                  ? ` · ${item.currentFormat.toUpperCase()} → ${item.format.toUpperCase()}`
                  : item.format
                    ? ` · ${item.format.toUpperCase()}`
                    : ''}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={item.path}>
                {item.path}
              </div>
              {(item.currentVersion || item.incomingVersion) && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.currentVersion ? `Library: ${item.currentVersion}` : ''}
                  {item.currentVersion && item.incomingVersion ? ' · ' : ''}
                  {item.incomingVersion ? `Incoming: ${item.incomingVersion}` : ''}
                </div>
              )}
              {scope ? <p className="mt-1 text-xs text-muted-foreground">{scope}</p> : null}
              {item.reason ? <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.choices.map((choice) => {
                  const active = (choices[item.id] ?? item.defaultChoice) === choice
                  return (
                    <Button
                      key={choice}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      onClick={() => setChoices((current) => ({ ...current, [item.id]: choice }))}
                    >
                      {planChoiceLabel(choice)}
                    </Button>
                  )
                })}
              </div>
            </div>
            )
          })}
        </div>
        {installAsSelected && (
          <div className="space-y-1 pt-2">
            <label htmlFor="import-family-name" className="text-sm font-medium">
              Install as
            </label>
            <Input
              id="import-family-name"
              value={familyName}
              placeholder="A separate family name"
              onChange={(event) => setFamilyName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This name is used for every selected “Install as…” item in this plan.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={installAsSelected && !familyName.trim()}
            onClick={() => onConfirm(choices, installAsSelected ? familyName.trim() : undefined)}
          >
            Apply plan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
