import { toast } from 'sonner'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Tab } from '@/components/Sidebar'
import { api } from '@/lib/api'
import {
  activatableIds,
  adobeInstallableIds,
  adobeRemovableIds,
  deactivatableIds,
  installableIds,
  reinstallableIds,
  repairableIds,
  uninstallableIds,
} from '@/lib/eligibility'
import {
  conflictInstanceNames,
  countFormats,
  entryFormatOf,
  occupyingDestinationIds,
  occupyingIdsForFormat,
  listFormatConflicts,
  formatSwap,
  formatSwapLabel,
  instanceFormatSwap,
  instanceSwapLabel,
  type FormatCount,
} from '@/lib/formats'
import {
  deletableSourceIds,
  entryHasTrackedSource,
  entryIds,
  familyNameOf,
  forgettableIds,
  hasTrackedSource,
  isForgettableOnlyGroup,
  isUninstallableGroup,
  uniquePaths,
} from '@/lib/group'
import { canSwitchTo } from '@/lib/identity'
import { actionCopy, actionCopyFor, adobeInstallCopy, adobeUninstallCopy, remainingActionCopy } from '@/lib/notify'
import { batchResultCopy, type BatchOutcome } from '@/lib/results'
import { doneToastAction, latestUndoableOperationId } from '@/lib/toastAction'
import { updateGroupsForIds } from '@/lib/updateInventory'
import type {
  CatalogEntry,
  DestinationId,
  FamilyGroup,
  Operation,
  SystemFace,
  SystemFamilyGroup,
} from '@/lib/types'

export type FormatPrompt = {
  formats: FormatCount[]
  confirmVerb: 'Install' | 'Add'
  resolve: (format: string | null) => void
}

export type ReplacePrompt = {
  incomingFormat: string
  existingFormat: string
  names: string[]
  resolve: (choice: 'replace' | 'keep' | null) => void
}

export type FontActionInput = {
  entries: CatalogEntry[]
  setEntries: Dispatch<SetStateAction<CatalogEntry[]>>
  setSystemFaces: Dispatch<SetStateAction<SystemFace[]>>
  operations: Operation[]
  setOperations: Dispatch<SetStateAction<Operation[]>>
  busyRef: MutableRefObject<boolean>
  setBusy: Dispatch<SetStateAction<boolean>>
  setActionStatus: (message: string | null) => void
  setTab: Dispatch<SetStateAction<Tab>>
  setWatchFolderFilter: Dispatch<SetStateAction<string | null>>
  setHighlightOperation: Dispatch<SetStateAction<string | null>>
  selectedCatalogGroups: () => FamilyGroup[]
  selectedSystemList: () => SystemFamilyGroup[]
  tab: Tab
  allUpdates: FamilyGroup[]
  setFormatPrompt: Dispatch<SetStateAction<FormatPrompt | null>>
  setReplacePrompt: Dispatch<SetStateAction<ReplacePrompt | null>>
}

export function useFontActions({
  entries,
  setEntries,
  setSystemFaces,
  operations,
  setOperations,
  busyRef,
  setBusy,
  setActionStatus,
  setTab,
  setWatchFolderFilter,
  setHighlightOperation,
  selectedCatalogGroups,
  selectedSystemList,
  tab,
  allUpdates,
  setFormatPrompt,
  setReplacePrompt,
}: FontActionInput) {
  function askFormat(formats: FormatCount[], confirmVerb: 'Install' | 'Add'): Promise<string | null> {
    return new Promise((resolve) => {
      setFormatPrompt({ formats, confirmVerb, resolve })
    })
  }

  function askReplace(conflicts: ReturnType<typeof listFormatConflicts>): Promise<'replace' | 'keep' | null> {
    const incomingFormat = entryFormatOf(conflicts[0].incoming)
    const existingFormat = entryFormatOf(conflicts[0].existing)
    return new Promise((resolve) => {
      setReplacePrompt({
        incomingFormat,
        existingFormat,
        names: conflictInstanceNames(conflicts),
        resolve,
      })
    })
  }

  async function prepareInstall(
    ids: string[],
    catalog = entries,
    confirmVerb: 'Install' | 'Add' = 'Install',
  ): Promise<{ ids: string[]; replace: boolean } | null> {
    const incoming = ids
      .map((id) => catalog.find((entry) => entry.id === id))
      .filter((entry): entry is CatalogEntry => Boolean(entry))
    if (incoming.length === 0) return null
    const formats = countFormats(incoming.map((entry) => entryFormatOf(entry)))
    let chosen = incoming
    if (formats.length > 1) {
      const format = await askFormat(formats, confirmVerb)
      if (!format) return null
      chosen = incoming.filter((entry) => entryFormatOf(entry) === format)
    }
    if (chosen.length === 0) return null
    const conflicts = listFormatConflicts(chosen, catalog)
    if (conflicts.length === 0) {
      return { ids: chosen.map((entry) => entry.id), replace: false }
    }
    const choice = await askReplace(conflicts)
    if (choice === null) return null
    if (choice === 'keep') {
      const skip = new Set(conflicts.map((item) => item.incoming.id))
      const rest = chosen.filter((entry) => !skip.has(entry.id))
      if (rest.length === 0) return null
      return { ids: rest.map((entry) => entry.id), replace: false }
    }
    return { ids: chosen.map((entry) => entry.id), replace: true }
  }

  function instanceSubject(entry: CatalogEntry): string {
    const style = entry.faces[0]?.styleName
    const family = familyNameOf(entry)
    return style ? `${family} ${style}` : family
  }

  function installPrepared(
    ids: string[],
    familyName?: string,
    replace?: boolean,
    destinationIds?: DestinationId[],
  ) {
    const options = { replace, destinationIds }
    return ids.length > 1
      ? api.installMany(ids, familyName, options)
      : api.install(ids[0], familyName, options)
  }

  function combineBatchResults(results: unknown[]): BatchOutcome | undefined {
    const batches = results.filter((result): result is BatchOutcome => {
      if (!result || typeof result !== 'object') return false
      const value = result as Record<string, unknown>
      return ['succeeded', 'failed', 'skipped', 'preview', 'errors', 'failedIds'].some((key) => key in value)
    })
    if (batches.length === 0) return undefined
    return {
      succeeded: batches.reduce((sum, result) => sum + (result.succeeded ?? 0), 0),
      failed: batches.reduce((sum, result) => sum + (result.failed ?? 0), 0),
      skipped: batches.reduce((sum, result) => sum + (result.skipped ?? 0), 0),
      preview: batches.reduce((sum, result) => sum + (result.preview ?? 0), 0),
      errors: batches.flatMap((result) => result.errors ?? []),
      failedIds: batches.flatMap((result) => result.failedIds ?? []),
    }
  }

  function activatePrepared(ids: string[], replace?: boolean, destinationIds?: DestinationId[]) {
    const needsSwitch = ids.some((id) => {
      const entry = entries.find((item) => item.id === id)
      return entry ? canSwitchTo(entry, entries) : false
    })
    const options = { replace, switch: needsSwitch, destinationIds }
    return ids.length > 1 ? api.activateMany(ids, options) : api.activate(ids[0], options)
  }

  function uninstallGroup(group: FamilyGroup, options?: { deleteSource?: boolean }) {
    const ids = uninstallableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    return ids.length > 1 ? api.uninstallMany(ids, options) : api.uninstall(ids[0], options)
  }

  function uninstallFormatFrom(groups: FamilyGroup[], format: string) {
    const ids = groups.flatMap((group) => occupyingIdsForFormat(group.entries, format))
    if (ids.length === 0) return
    const label =
      groups.length === 1
        ? `${groups[0]!.familyName} ${format.toUpperCase()}`
        : `${format.toUpperCase()} from ${groups.length} fonts`
    void run(
      () => (ids.length > 1 ? api.uninstallMany(ids) : api.uninstall(ids[0]!)),
      actionCopy('remove', label),
      { undo: 'uninstall' },
    )
  }

  function swapFormatFrom(group: FamilyGroup) {
    const swap = formatSwap(group.entries)
    if (!swap) return
    const incoming = swap.incomingIds
      .map((id) => group.entries.find((entry) => entry.id === id))
      .filter((entry): entry is CatalogEntry => Boolean(entry))
    const toActivate = incoming.filter((entry) => entry.status === 'deactivated').map((entry) => entry.id)
    const toInstall = incoming.filter((entry) => entry.status === 'uninstalled').map((entry) => entry.id)
    if (toActivate.length === 0 && toInstall.length === 0) return
    const destinationIds = occupyingDestinationIds(group.entries, swap.from)
    const label = formatSwapLabel(swap)
    const replace = swap.occupying
    void run(async () => {
      if (toActivate.length) await activatePrepared(toActivate, replace, destinationIds)
      if (toInstall.length) await installPrepared(toInstall, undefined, replace, destinationIds)
    }, {
      pending: `${label}…`,
      done: swap.occupying
        ? `Swapped ${swap.from.toUpperCase()} for ${swap.to.toUpperCase()}`
        : `Installed ${swap.to.toUpperCase()}`,
    })
  }

  function swapInstanceFormat(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry.previewOnly) return
    const family = entries.filter((item) => familyNameOf(item) === familyNameOf(entry))
    const swap = instanceFormatSwap(entry, family)
    if (!swap) return
    const incoming = family.find((item) => item.id === swap.incomingIds[0])
    if (!incoming) return
    const destinationIds = occupyingDestinationIds(family, swap.from)
    const label = instanceSwapLabel(swap, id)
    void run(
      async () => {
        if (incoming.status === 'deactivated') {
          await activatePrepared([incoming.id], true, destinationIds)
          return
        }
        await installPrepared([incoming.id], undefined, true, destinationIds)
      },
      { pending: `${label}…`, done: `Swapped ${swap.from.toUpperCase()} for ${swap.to.toUpperCase()}` },
    )
  }

  function deactivateGroup(group: FamilyGroup) {
    const ids = deactivatableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    return ids.length > 1 ? api.deactivateMany(ids) : api.deactivate(ids[0])
  }

  function reinstallGroup(group: FamilyGroup) {
    const ids = reinstallableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    return ids.length > 1 ? api.reinstallMany(ids) : api.reinstall(ids[0])
  }

  function forgetGroup(group: FamilyGroup, options?: { deleteFiles?: boolean }) {
    const ids = options?.deleteFiles ? deletableSourceIds(group) : forgettableIds(group)
    if (ids.length === 0) {
      return Promise.resolve({ removed: 0 })
    }
    return ids.length > 1 ? api.forgetMany(ids, options) : api.forget(ids[0], options)
  }

  function forgetEntry(entry: CatalogEntry, options?: { deleteFiles?: boolean }) {
    return api.forget(entry.id, options)
  }

  async function removeSelected() {
    if (tab === 'system') {
      const groups = selectedSystemList().filter((group) => group.writable)
      if (groups.length === 0) return
      await run(async () => {
        for (const group of groups) {
          for (const face of uniquePaths(group.faces)) {
            await api.uninstallSystem(face)
          }
        }
        setSystemFaces((await api.system()).faces)
      }, actionCopyFor('remove', groups))
      return
    }
    const groups = selectedCatalogGroups()
    const toUninstall = groups.filter(isUninstallableGroup)
    const toForget = groups.filter(isForgettableOnlyGroup)
    if (toUninstall.length === 0 && toForget.length === 0) return
    const copyGroups = [...toUninstall, ...toForget]
    const verb = toUninstall.length === 0 ? 'forget' : 'remove'
    const uninstallIds = toUninstall.flatMap((group) => uninstallableIds(group))
    await run(
      async () => {
        let last: unknown
        if (uninstallIds.length > 1) {
          last = await api.uninstallMany(uninstallIds)
        } else if (uninstallIds.length === 1) {
          last = await api.uninstall(uninstallIds[0]!)
        }
        for (const group of toForget) {
          await forgetGroup(group)
        }
        return last
      },
      actionCopyFor(verb, copyGroups),
      uninstallIds.length > 0 && toForget.length === 0 ? { undo: 'uninstall' } : undefined,
    )
  }

  async function installSelected() {
    const groups = selectedCatalogGroups().filter((group) => installableIds(group).length > 0)
    if (groups.length === 0) return
    const prepared = await prepareInstall(groups.flatMap(installableIds))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
      const results: unknown[] = []
      for (let index = 0; index < groups.length; index += 1) {
        const ids = installableIds(groups[index]).filter((id) => allowed.has(id))
        if (ids.length === 0) continue
        setActionStatus(
          remainingActionCopy(
            'install',
            groups.length - index,
            groups.length === 1 ? groups[0].familyName : undefined,
          ),
        )
        results.push(await installPrepared(ids, undefined, prepared.replace))
      }
      return combineBatchResults(results)
    }, actionCopyFor('install', groups))
  }

  async function activateSelected() {
    const groups = selectedCatalogGroups().filter((group) => activatableIds(group).length > 0)
    if (groups.length === 0) return
    const prepared = await prepareInstall(groups.flatMap(activatableIds))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
      const results: unknown[] = []
      for (const group of groups) {
        const ids = activatableIds(group).filter((id) => allowed.has(id))
        if (ids.length === 0) continue
        results.push(await activatePrepared(ids, prepared.replace))
      }
      return combineBatchResults(results)
    }, actionCopyFor('activate', groups))
  }

  async function installOrActivateSelected() {
    const groups = selectedCatalogGroups().filter(
      (group) => installableIds(group).length > 0 || activatableIds(group).length > 0,
    )
    if (groups.length === 0) return
    const verb = groups.every((group) => activatableIds(group).length > 0 && installableIds(group).length === 0)
      ? 'activate'
      : 'install'
    const prepared = await prepareInstall(groups.flatMap((group) => [...installableIds(group), ...activatableIds(group)]))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
      const results: unknown[] = []
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index]
        const toActivate = activatableIds(group).filter((id) => allowed.has(id))
        const toInstall = installableIds(group).filter((id) => allowed.has(id))
        if (toActivate.length === 0 && toInstall.length === 0) continue
        setActionStatus(
          remainingActionCopy(
            verb,
            groups.length - index,
            groups.length === 1 ? groups[0].familyName : undefined,
          ),
        )
        if (toActivate.length) results.push(await activatePrepared(toActivate, prepared.replace))
        if (toInstall.length) results.push(await installPrepared(toInstall, undefined, prepared.replace))
      }
      return combineBatchResults(results)
    }, actionCopyFor(verb, groups))
  }

  async function installGroupGuarded(group: FamilyGroup, familyName?: string) {
    const prepared = await prepareInstall(installableIds(group).length ? installableIds(group) : entryIds(group))
    if (!prepared) return
    await run(
      () => installPrepared(prepared.ids, familyName, prepared.replace),
      actionCopy('install', group.familyName),
    )
  }

  async function installToAdobeFor(groups: FamilyGroup[]) {
    const ids = groups.flatMap((group) => adobeInstallableIds(group))
    if (ids.length === 0) return
    await run(async () => {
      for (const id of ids) {
        await api.install(id, undefined, { destinationId: 'adobe-shared' })
      }
    }, adobeInstallCopy(ids.length))
  }

  async function installInstanceGuarded(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry.previewOnly) return
    const prepared = await prepareInstall([id])
    if (!prepared) return
    await run(
      () => installPrepared(prepared.ids, undefined, prepared.replace),
      actionCopy('install', instanceSubject(entry)),
    )
  }

  async function activateInstanceGuarded(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry.previewOnly) return
    const prepared = await prepareInstall([id])
    if (!prepared) return
    await run(
      () => activatePrepared(prepared.ids, prepared.replace),
      actionCopy('activate', instanceSubject(entry)),
    )
  }

  async function deactivateInstance(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return
    await run(() => api.deactivate(id), actionCopy('deactivate', instanceSubject(entry)))
  }

  async function uninstallInstance(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return
    await run(() => api.uninstall(id), actionCopy('remove', instanceSubject(entry)), { undo: 'uninstall' })
  }

  async function installInstanceToAdobe(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return
    await run(
      () => api.install(id, undefined, { destinationId: 'adobe-shared' }),
      adobeInstallCopy(1),
    )
  }

  // Only `entries` is ever read, and `adobeRemovableIds` already takes that shape. Asking for a whole
  // FamilyGroup would force callers with a single entry to fabricate the other eight fields.
  async function uninstallFromAdobeFor(groups: Array<Pick<FamilyGroup, 'entries'>>) {
    const ids = groups.flatMap((group) => adobeRemovableIds(group))
    if (ids.length === 0) return
    await run(async () => {
      for (const id of ids) {
        await api.removeDestinationCopy(id, 'adobe-shared')
      }
    }, adobeUninstallCopy(ids.length))
  }

  async function uninstallInstanceFromAdobe(id: string) {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return
    await uninstallFromAdobeFor([{ entries: [entry] }])
  }

  async function activateGroupGuarded(group: FamilyGroup) {
    const prepared = await prepareInstall(activatableIds(group).length ? activatableIds(group) : entryIds(group))
    if (!prepared) return
    await run(
      () => activatePrepared(prepared.ids, prepared.replace),
      actionCopy('activate', group.familyName),
    )
  }

  async function reinstallSelected() {
    const groups = selectedCatalogGroups().filter((group) => reinstallableIds(group).length > 0)
    if (groups.length === 0) return
    await run(async () => {
      const results: unknown[] = []
      for (const group of groups) {
        results.push(await reinstallGroup(group))
      }
      return combineBatchResults(results)
    }, actionCopyFor('reinstall', groups))
  }

  async function repairSelected() {
    const groups = selectedCatalogGroups()
    const ids = groups.flatMap(repairableIds)
    if (ids.length === 0) return
    await run(() => api.repair(ids, false), {
      pending: 'Repairing fonts…',
      done: 'Repaired installed versions',
    })
  }

  async function reinstallAllUpdates() {
    const groups = allUpdates
    if (groups.length === 0) return
    await run(async () => {
      const results: unknown[] = []
      for (const group of groups) {
        results.push(await reinstallGroup(group))
      }
      return combineBatchResults(results)
    }, actionCopyFor('reinstall', groups))
  }

  function reinstallFromMenuBar(ids: string[]) {
    if (busyRef.current) {
      toast.message('Wait for the current action to finish.')
      return
    }
    const groups = updateGroupsForIds(allUpdates, ids)
    if (groups.length === 0) {
      const leftover = ids.filter((id) => entries.some((entry) => entry.id === id && entry.status === 'outdated'))
      if (leftover.length === 0) {
        toast.message('No font updates to reinstall.')
        return
      }
      setTab('updates')
      setWatchFolderFilter(null)
      void run(() => (leftover.length > 1 ? api.reinstallMany(leftover) : api.reinstall(leftover[0])), {
        pending: 'Reinstalling fonts…',
        done: 'Reinstalled fonts',
      })
      return
    }
    setTab('updates')
    setWatchFolderFilter(null)
    void run(async () => {
      const results: unknown[] = []
      for (const group of groups) {
        results.push(await reinstallGroup(group))
      }
      return combineBatchResults(results)
    }, actionCopyFor('reinstall', groups))
  }

  async function forgetSelected() {
    const groups = selectedCatalogGroups().filter((group) => forgettableIds(group).length > 0)
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await forgetGroup(group)
      }
    }, actionCopyFor('forget', groups))
  }

  async function deleteFilesFor(groups: FamilyGroup[]) {
    const targets = groups.filter((group) => deletableSourceIds(group).length > 0)
    if (targets.length === 0) return
    const fileCount = targets.reduce((sum, group) => sum + deletableSourceIds(group).length, 0)
    const confirmed = window.confirm(
      fileCount === 1
        ? `Delete the source file for ${targets[0].familyName}? It will be moved to Trash.`
        : `Delete ${fileCount} source files? They will be moved to Trash.`,
    )
    if (!confirmed) return
    await run(async () => {
      for (const group of targets) {
        await forgetGroup(group, { deleteFiles: true })
      }
    }, actionCopyFor('deleteFiles', targets))
  }

  async function deleteFilesSelected() {
    await deleteFilesFor(selectedCatalogGroups())
  }

  async function uninstallAndRemoveFor(groups: FamilyGroup[]) {
    const targets = groups.filter(
      (group) => isUninstallableGroup(group) && hasTrackedSource(group),
    )
    if (targets.length === 0) return
    const fileCount = targets.reduce(
      (sum, group) => sum + group.entries.filter(entryHasTrackedSource).length,
      0,
    )
    const confirmed = window.confirm(
      fileCount === 1
        ? `Uninstall ${targets[0].familyName} and move its source file to Trash?`
        : `Uninstall ${targets.length} fonts and move ${fileCount} source files to Trash?`,
    )
    if (!confirmed) return
    await run(async () => {
      for (const group of targets) {
        await uninstallGroup(group, { deleteSource: true })
      }
    }, actionCopyFor('uninstallAndRemove', targets))
  }

  async function uninstallAndRemoveSelected() {
    await uninstallAndRemoveFor(selectedCatalogGroups())
  }

  async function uninstallSelected() {
    if (tab === 'system') {
      await removeSelected()
      return
    }
    const groups = selectedCatalogGroups().filter(
      (group) =>
        group.status === 'installed' ||
        group.status === 'outdated' ||
        group.status === 'deactivated',
    )
    if (groups.length === 0) return
    const ids = groups.flatMap((group) => uninstallableIds(group))
    if (ids.length === 0) return
    await run(
      () => (ids.length > 1 ? api.uninstallMany(ids) : api.uninstall(ids[0]!)),
      actionCopyFor('remove', groups),
      { undo: 'uninstall' },
    )
  }

  async function deactivateSelected() {
    if (tab === 'system') {
      const groups = selectedSystemList().filter((group) => group.writable)
      if (groups.length === 0) return
      await run(async () => {
        for (const group of groups) {
          for (const face of uniquePaths(group.faces)) {
            await api.deactivateSystem(face)
          }
        }
        setSystemFaces((await api.system()).faces)
      }, actionCopyFor('deactivate', groups))
      return
    }
    const groups = selectedCatalogGroups().filter((group) => deactivatableIds(group).length > 0)
    if (groups.length === 0) return
    await run(async () => {
      for (const group of groups) {
        await deactivateGroup(group)
      }
    }, actionCopyFor('deactivate', groups))
  }

  function showDoneToast(
    message: string,
    failedIds: string[] = [],
    options?: { operationId?: string; undo?: 'uninstall' },
  ) {
    const action = doneToastAction({
      failedIds,
      operationId: options?.operationId,
      undo: options?.undo === 'uninstall',
    })
    toast.success(message, {
      action: {
        label: action.label,
        onClick: () => {
          if (action.kind === 'retry') {
            void retryFailed(failedIds)
            return
          }
          if (action.kind === 'undo') {
            void run(() => api.undo(action.operationId), {
              pending: 'Undoing…',
              done: 'Undid the last change',
            })
            return
          }
          setHighlightOperation(action.operationId ?? null)
          setTab('activity')
        },
      },
    })
  }

  async function retryFailed(ids: string[]) {
    const current = entries.filter((entry) => ids.includes(entry.id))
    const toUpdate = current.filter((entry) => entry.status === 'outdated' && !entry.previewOnly)
    const toInstall = current.filter((entry) => entry.status === 'uninstalled' && !entry.previewOnly)
    if (toUpdate.length === 0 && toInstall.length === 0) {
      toast.message('Those items are no longer eligible to retry.')
      return
    }
    await run(async () => {
      const results: unknown[] = []
      if (toUpdate.length) {
        results.push(await (toUpdate.length > 1 ? api.reinstallMany(toUpdate.map((entry) => entry.id)) : api.reinstall(toUpdate[0]!.id)))
      }
      if (toInstall.length) {
        results.push(await installPrepared(toInstall.map((entry) => entry.id)))
      }
      return combineBatchResults(results)
    }, { pending: 'Retrying failed items…', done: 'Retried failed items' })
  }

  async function run(
    action: () => Promise<unknown>,
    copy: { pending: string; done: string },
    options?: { undo?: 'uninstall' },
  ) {
    busyRef.current = true
    setBusy(true)
    setActionStatus(copy.pending)
    try {
      const result = await action()
      setActionStatus(null)
      const outcome = result && typeof result === 'object' ? (result as BatchOutcome) : undefined
      const { message, failedIds } = batchResultCopy(copy.done, outcome)
      const catalog = await api.catalog()
      setEntries(catalog.entries)
      const activity = await api.activity().catch(() => ({ operations }))
      setOperations(activity.operations)
      const operationId =
        (result as { operationId?: string } | undefined)?.operationId ??
        (options?.undo === 'uninstall'
          ? latestUndoableOperationId(activity.operations, 'uninstall')
          : undefined)
      const undoable =
        (result as { undoable?: boolean } | undefined)?.undoable ??
        Boolean(options?.undo && operationId)
      showDoneToast(message, failedIds, {
        operationId,
        undo: undoable ? options?.undo : undefined,
      })
    } catch (err) {
      setActionStatus(null)
      toast.error(err instanceof Error ? err.message : 'Something went wrong', {
        action: {
          label: 'Activity',
          onClick: () => setTab('activity'),
        },
      })
      try {
        const catalog = await api.catalog()
        setEntries(catalog.entries)
      } catch {
        // Keep the last known catalog if the refresh fails.
      }
    } finally {
      busyRef.current = false
      setBusy(false)
      setActionStatus(null)
    }
  }

  return {
    uninstallGroup,
    deactivateGroup,
    reinstallGroup,
    forgetGroup,
    forgetEntry,
    removeSelected,
    installSelected,
    activateSelected,
    installOrActivateSelected,
    installGroupGuarded,
    installToAdobeFor,
    installInstanceGuarded,
    activateInstanceGuarded,
    deactivateInstance,
    uninstallInstance,
    installInstanceToAdobe,
    uninstallFromAdobeFor,
    uninstallInstanceFromAdobe,
    activateGroupGuarded,
    reinstallSelected,
    repairSelected,
    reinstallAllUpdates,
    reinstallFromMenuBar,
    forgetSelected,
    deleteFilesFor,
    deleteFilesSelected,
    uninstallAndRemoveFor,
    uninstallAndRemoveSelected,
    uninstallSelected,
    uninstallFormatFrom,
    swapFormatFrom,
    swapInstanceFormat,
    deactivateSelected,
    showDoneToast,
    run,
  }
}
