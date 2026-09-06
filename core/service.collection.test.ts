import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { classifyImportFile } from './planner.ts'
import { withService, writeTestCollection, writeTestFont } from './test-util.ts'

function liveFontNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => /\.(ttf|otf|ttc|otc)$/i.test(name))
}

test('F05-D a TTC with one overlapping face lists every collection face and installs as one file', async () => {
  await withService(async (service, paths) => {
    const regular = path.join(paths.dataRoot, 'Pack-Regular.ttf')
    const collection = path.join(paths.dataRoot, 'Pack.ttc')
    writeTestFont(regular, 'Pack', 'Pack-Regular', { style: 'Regular' })
    writeTestCollection(collection, [
      { family: 'Pack', psName: 'Pack-Regular', style: 'Regular' },
      { family: 'Pack', psName: 'Pack-Bold', style: 'Bold' },
    ])

    const imported = await service.importPaths([regular])
    const installed = await service.install(imported.entries[0]!.id)
    assert.equal(installed.faces.length, 1)

    const conflict = classifyImportFile(collection, { version: 1, entries: service.listCatalog() })
    assert.equal(conflict.classification, 'collection-overlap')
    assert.equal(conflict.format, 'ttc')
    assert.equal(conflict.faces?.length, 2)
    assert.ok(conflict.affectedFaces?.includes('Pack Regular'))
    assert.ok(conflict.affectedFaces?.includes('Pack Bold'))
    assert.equal(new Set(conflict.affectedFaces).size, conflict.affectedFaces?.length)
    assert.match(conflict.reason ?? '', /every face|collection/i)

    const plan = service.planImport([collection])
    const overlap = plan.items.find((item) => item.classification === 'collection-overlap')
    assert.ok(overlap)
    assert.ok(plan.summary.review >= 1)
    await service.applyPlan(plan.id, { [overlap.id]: 'replace' })

    const catalog = service.listCatalog()
    const pack = catalog.filter((item) => item.faces.some((face) => face.familyName === 'Pack'))
    assert.equal(pack.length, 1)
    assert.equal(pack[0]!.id, installed.id)
    assert.equal(pack[0]!.format, 'ttc')
    assert.equal(pack[0]!.faces.length, 2)
    assert.ok(pack[0]!.installedPath?.toLowerCase().endsWith('.ttc'))
    assert.equal(liveFontNames(paths.installDir).length, 1)
    assert.equal(fs.existsSync(pack[0]!.installedPath!), true)
    assert.equal(pack[0]!.faces.length > 1, true)

    const meta = service.previewMeta(pack[0]!.id, 'installed')
    assert.equal(meta.faces.length, 2)
    assert.deepEqual(
      meta.faces.map((face) => face.postscriptName).sort(),
      ['Pack-Bold', 'Pack-Regular'],
    )

    const parked = await service.deactivate(pack[0]!.id)
    assert.equal(parked.status, 'deactivated')
    assert.equal(fs.existsSync(pack[0]!.installedPath!), false)
    assert.ok(parked.disabledPath && fs.existsSync(parked.disabledPath))
    assert.equal(parked.faces.length, 2)
    assert.equal(liveFontNames(paths.installDir).length, 0)
  })
})

test('a new TTC imports and installs once with every face exposed', async () => {
  await withService(async (service, paths) => {
    const collection = path.join(paths.dataRoot, 'Family.ttc')
    writeTestCollection(collection, [
      { family: 'Family', psName: 'Family-Regular', style: 'Regular' },
      { family: 'Family', psName: 'Family-Bold', style: 'Bold' },
    ])
    const plan = service.planImport([collection])
    assert.equal(plan.items[0]!.classification, 'new')
    assert.equal(plan.items[0]!.faces?.length, 2)
    const imported = await service.importPaths([collection])
    assert.equal(imported.entries.length, 1)
    assert.equal(imported.entries[0]!.faces.length, 2)
    assert.equal(imported.entries[0]!.format, 'ttc')
    const installed = await service.install(imported.entries[0]!.id)
    assert.equal(installed.faces.length, 2)
    assert.equal(fs.existsSync(installed.installedPath!), true)
    assert.equal(liveFontNames(paths.installDir).length, 1)
    await service.uninstall(installed.id)
    assert.equal(fs.existsSync(installed.installedPath!), false)
    assert.equal(service.listCatalog().find((item) => item.id === installed.id)?.faces.length, 2)
  })
})
