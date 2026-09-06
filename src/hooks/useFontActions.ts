import { toast } from 'sonner'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Tab } from '@/components/Sidebar'
import { api } from '@/lib/api'
import {
  activatableIds,
  adobeInstallableIds,
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
  listFormatConflicts,
  type FormatCount,
} from '@/lib/formats'
import {
  deletableSourceIds,
  entryHasTrackedSource,
  entryIds,
  forgettableIds,
  hasTrackedSource,
  isForgettableOnlyGroup,
  isUninstallableGroup,
  uniquePaths,
} from '@/lib/group'
import { canSwitchTo } from '@/lib/identity'
import { actionCopy, actionCopyFor, adobeInstallCopy, remainingActionCopy } from '@/lib/notify'
import { batchResultCopy, type BatchOutcome } from '@/lib/results'
import { updateGroupsForIds } from '@/lib/updateInventory'
import type { CatalogEntry, ComparisonCapture, FamilyGroup, Operation, SystemFace, SystemFamilyGroup } from '@/lib/types'

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
  comparisonCapture: ComparisonCapture | null
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
  comparisonCapture,
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

  function comparisonFingerprintFor(ids: string[]): string | undefined {
    if (ids.length !== 1) return undefined
    if (comparisonCapture?.id !== ids[0]) return undefined
    return comparisonCapture.sourceFingerprint
  }

  function installPrepared(ids: string[], familyName?: string, replace?: boolean) {
    const expectedSourceFingerprint = comparisonFingerprintFor(ids)
    return ids.length > 1
      ? api.installMany(ids, familyName, { replace, expectedSourceFingerprint })
      : api.install(ids[0], familyName, { replace, expectedSourceFingerprint })
  }

  function activatePrepared(ids: string[], replace?: boolean) {
    const needsSwitch = ids.some((id) => {
      const entry = entries.find((item) => item.id === id)
      return entry ? canSwitchTo(entry, entries) : false
    })
    const options = { replace, switch: needsSwitch }
    return ids.length > 1 ? api.activateMany(ids, options) : api.activate(ids[0], options)
  }

  function uninstallGroup(group: FamilyGroup, options?: { deleteSource?: boolean }) {
    const ids = uninstallableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    return ids.length > 1 ? api.uninstallMany(ids, options) : api.uninstall(ids[0], options)
  }

  function deactivateGroup(group: FamilyGroup) {
    const ids = deactivatableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    return ids.length > 1 ? api.deactivateMany(ids) : api.deactivate(ids[0])
  }

  function reinstallGroup(group: FamilyGroup) {
    const ids = reinstallableIds(group)
    if (ids.length === 0) return Promise.resolve({ entries: [] })
    const expectedSourceFingerprint = comparisonFingerprintFor(ids)
    return ids.length > 1
      ? api.reinstallMany(ids, { expectedSourceFingerprint })
      : api.reinstall(ids[0], { expectedSourceFingerprint })
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
    await run(async () => {
      for (const group of toUninstall) {
        await uninstallGroup(group)
      }
      for (const group of toForget) {
        await forgetGroup(group)
      }
    }, actionCopyFor(verb, copyGroups))
  }

  async function installSelected() {
    const groups = selectedCatalogGroups().filter((group) => installableIds(group).length > 0)
    if (groups.length === 0) return
    const prepared = await prepareInstall(groups.flatMap(installableIds))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
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
        await installPrepared(ids, undefined, prepared.replace)
      }
    }, actionCopyFor('install', groups))
  }

  async function activateSelected() {
    const groups = selectedCatalogGroups().filter((group) => activatableIds(group).length > 0)
    if (groups.length === 0) return
    const prepared = await prepareInstall(groups.flatMap(activatableIds))
    if (!prepared) return
    const allowed = new Set(prepared.ids)
    await run(async () => {
      for (const group of groups) {
        const ids = activatableIds(group).filter((id) => allowed.has(id))
        if (ids.length === 0) continue
        await activatePrepared(ids, prepared.replace)
      }
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
        if (toActivate.length) await activatePrepared(toActivate, prepared.replace)
        if (toInstall.length) await installPrepared(toInstall, undefined, prepared.replace)
      }
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
    const ids = groups.flatMap(adobeInstallableIds)
    if (ids.length === 0) return
    await run(async () => {
      for (const id of ids) {
        await api.install(id, undefined, { destinationId: 'adobe-shared' })
      }
    }, adobeInstallCopy(ids.length))
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
      for (const group of groups) {
        await reinstallGroup(group)
      }
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
      for (const group of groups) {
        await reinstallGroup(group)
      }
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
      for (const group of groups) {
        await reinstallGroup(group)
      }
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
    await run(async () => {
      for (const group of groups) {
        await uninstallGroup(group)
      }
    }, actionCopyFor('remove', groups))
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

  function showActivityToast(message: string, failedIds: string[] = [], operationId?: string) {
    toast.success(message, {
      action: {
        label: failedIds.length ? 'Retry failed' : 'Activity',
        onClick: () => {
          if (failedIds.length) {
            void retryFailed(failedIds)
            return
          }
          setHighlightOperation(operationId ?? null)
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
      if (toUpdate.length) {
        await (toUpdate.length > 1 ? api.reinstallMany(toUpdate.map((entry) => entry.id)) : api.reinstall(toUpdate[0]!.id))
      }
      if (toInstall.length) {
        await installPrepared(toInstall.map((entry) => entry.id))
      }
    }, { pending: 'Retrying failed items…', done: 'Retried failed items' })
  }

  async function run(
    action: () => Promise<unknown>,
    copy: { pending: string; done: string },
  ) {
    busyRef.current = true
    setBusy(true)
    setActionStatus(copy.pending)
    try {
      const result = await action()
      setActionStatus(null)
      const outcome = result && typeof result === 'object' ? (result as BatchOutcome) : undefined
      const { message, failedIds } = batchResultCopy(copy.done, outcome)
      showActivityToast(message, failedIds, (result as { operationId?: string } | undefined)?.operationId)
      const catalog = await api.catalog()
      setEntries(catalog.entries)
      const activity = await api.activity().catch(() => ({ operations }))
      setOperations(activity.operations)
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
    deactivateSelected,
    showActivityToast,
    run,
  }
}
