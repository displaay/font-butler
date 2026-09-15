/* Second-pass audit probes (not part of the suite). Uses temp dirs + mock native only. */
import fs from 'node:fs'
import path from 'node:path'
import { fingerprintFile } from '../../../core/fingerprint.ts'
import { loadCatalog, findById } from '../../../core/catalog.ts'
import { loadPlan } from '../../../core/planner.ts'
import { plansDir } from '../../../core/paths.ts'
import { loadOperations } from '../../../core/operations.ts'
import { tempPaths, writeTestFont, withService } from '../../../core/test-util.ts'

const out: Record<string, unknown> = {}

// Probe A: repair() saves a stale catalog snapshot after restoreRevision.
await withService(async (service, paths) => {
  const src = path.join(paths.dataRoot, 'src', 'RepairA.ttf')
  writeTestFont(src, 'RepairFam', 'RepairFam-Regular', { version: 'Version 1.000' })
  const imported = await service.importPaths([src])
  const id = imported.entries[0]!.id
  await service.install(id, undefined, { destinationIds: ['macos', 'adobe-shared'] })
  writeTestFont(src, 'RepairFam', 'RepairFam-Regular', { version: 'Version 2.000' })
  await service.reinstall(id)
  const before = findById(loadCatalog(paths), id)!
  const v1 = before.previousRevisionId!
  const installedPath = before.installedPath!
  const adobePath = before.installations?.find((c) => c.destinationId === 'adobe-shared')?.path!
  fs.rmSync(installedPath, { force: true })
  const repair = await service.repair([id])
  const after = findById(loadCatalog(paths), id)!
  const diskFp = fs.existsSync(installedPath) ? fingerprintFile(installedPath) : null
  const adobeFp = fs.existsSync(adobePath) ? fingerprintFile(adobePath) : null
  out.repair = {
    outcomes: repair.fonts.map((f) => `${f.target}:${f.outcome}`),
    installedFileRecreated: fs.existsSync(installedPath),
    catalogInstalledFpMatchesDisk: after.installedFingerprint === diskFp,
    catalogInstalledFp: after.installedFingerprint?.slice(0, 12),
    diskFp: diskFp?.slice(0, 12),
    expectedRestoredV1: v1.slice(0, 12),
    catalogPreviousRevision: after.previousRevisionId?.slice(0, 12),
    adobeCatalogFp: after.installations?.find((c) => c.destinationId === 'adobe-shared')?.fingerprint?.slice(0, 12),
    adobeDiskFp: adobeFp?.slice(0, 12),
  }
})

// Probe B: settings accept negative/zero numerics; retention prune wipes activity.
await withService(async (service, paths) => {
  const src = path.join(paths.dataRoot, 'src', 'SetB.ttf')
  writeTestFont(src, 'SetFam', 'SetFam-Regular')
  const imported = await service.importPaths([src])
  await service.install(imported.entries[0]!.id)
  const opsBefore = loadOperations(paths).length
  const next = await service.updateSettings({
    revisionBudgetBytes: -5,
    activityRetentionDays: -1,
    activityMaxOperations: 0,
  })
  const opsAfter = service.listActivity().length
  out.settings = {
    revisionBudgetBytes: next.revisionBudgetBytes,
    activityRetentionDays: next.activityRetentionDays,
    activityMaxOperations: next.activityMaxOperations,
    opsBefore,
    opsAfterListActivity: opsAfter,
  }
})

// Probe C: loadPlan planId traversal.
{
  const paths = tempPaths('fb-plan-')
  try {
    fs.mkdirSync(plansDir(paths), { recursive: true })
    fs.writeFileSync(path.join(paths.dataRoot, 'evil.json'), JSON.stringify({ id: '../evil', items: [] }))
    const loaded = loadPlan(paths, '../evil')
    out.planTraversal = { escapedPlansDir: loaded?.id === '../evil' }
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
}

console.log(JSON.stringify(out, null, 2))
