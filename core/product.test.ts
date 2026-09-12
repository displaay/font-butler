import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { classifyImportFile } from './planner.ts'
import { inspectRelinkCandidate } from './relink.ts'
import { fingerprintFile } from './fingerprint.ts'
import { displayStateLabel, inspectSourceAvailability, isCleanupEligible } from './state.ts'
import { createWatchFolder, isExcluded, policyFromFlags } from './folders.ts'
import { withService, writeTestFont, writeTestWebFont } from './test-util.ts'
import type { CatalogEntry } from './types.ts'

function entry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'sourcePath'>): CatalogEntry {
  return {
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [
      {
        familyName: 'Face',
        styleName: 'Regular',
        fullName: 'Face Regular',
        postscriptName: 'Face-Regular',
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('F01 display state keeps installation and source facts independent', () => {
  assert.match(
    displayStateLabel(
      entry({
        id: 'a',
        sourcePath: '/missing.ttf',
        status: 'installed',
        sourceAvailability: 'missing',
        sourcePresent: false,
      }),
    ),
    /Installed · Source missing/,
  )
  assert.match(
    displayStateLabel(
      entry({
        id: 'b',
        sourcePath: '/tmp/installed.ttf',
        installedPath: '/tmp/installed.ttf',
        status: 'installed',
        sourceAvailability: 'none',
        sourcePresent: false,
      }),
    ),
    /^Installed$/
  )
  assert.match(
    displayStateLabel(
      entry({
        id: 'c',
        sourcePath: '/Volumes/Offline/Font.ttf',
        status: 'installed',
        sourceAvailability: 'offline',
      }),
    ),
    /Source drive offline/,
  )
})

test('F01-B ambiguous basename matches require a choice', async () => {
  await withService(async (service, paths) => {
    const oldRoot = path.join(paths.dataRoot, 'old')
    const next = path.join(paths.dataRoot, 'next')
    fs.mkdirSync(path.join(oldRoot), { recursive: true })
    fs.mkdirSync(path.join(next, 'A'), { recursive: true })
    fs.mkdirSync(path.join(next, 'B'), { recursive: true })
    const source = path.join(oldRoot, 'Same.ttf')
    writeTestFont(source, 'Same', 'Same-Regular')
    const imported = await service.importPaths([source])
    writeTestFont(path.join(next, 'A', 'Same.ttf'), 'Same', 'Same-Regular')
    writeTestFont(path.join(next, 'B', 'Same.ttf'), 'Same', 'Same-Regular')
    const preview = service.inspectFolderRelink(oldRoot, next, true)
    const row = preview.rows.find((item) => item.entryId === imported.entries[0]!.id)
    assert.ok(row)
    assert.equal(row.status, 'ambiguous')
    assert.equal(row.candidates.length, 2)
    const applied = await service.applyFolderRelink(oldRoot, next, {})
    assert.equal(applied.length, 0)
    assert.equal(service.listCatalog()[0]!.id, imported.entries[0]!.id)
    assert.equal(service.listCatalog()[0]!.sourcePath, path.resolve(source))
  })
})

test('F01-A and F01-C folder relink preserves ids and does not install', async () => {
  await withService(async (service, paths) => {
    const oldRoot = path.join(paths.dataRoot, 'client')
    const next = path.join(paths.dataRoot, 'moved')
    fs.mkdirSync(oldRoot, { recursive: true })
    const source = path.join(oldRoot, 'Family.ttf')
    writeTestFont(source, 'Relink', 'Relink-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const bytes = fs.readFileSync(installed.installedPath!)
    fs.mkdirSync(next, { recursive: true })
    const changed = path.join(next, 'Family.ttf')
    writeTestFont(changed, 'Relink', 'Relink-Regular')
    fs.appendFileSync(changed, Buffer.from([1, 2, 3]))
    fs.rmSync(oldRoot, { recursive: true, force: true })
    const preview = service.inspectFolderRelink(oldRoot, next, true)
    assert.equal(preview.rows[0]?.status, 'changed')
    const applied = await service.applyFolderRelink(oldRoot, next, {
      [installed.id]: preview.rows[0]!.selected,
    })
    assert.equal(applied[0]!.id, installed.id)
    assert.equal(applied[0]!.sourcePath, path.resolve(changed))
    assert.equal(applied[0]!.status, 'outdated')
    assert.equal(applied[0]!.updateHold, 'relink-review')
    assert.deepEqual(fs.readFileSync(applied[0]!.installedPath!), bytes)
  })
})

test('F01-E linking a source does not overwrite installed bytes', async () => {
  await withService(async (service, paths) => {
    const installedPath = path.join(paths.installDir, 'Adopted.ttf')
    writeTestFont(installedPath, 'Adopt', 'Adopt-Regular')
    await service.init()
    const row = service.listCatalog().find((item) => item.installedPath === installedPath)
    assert.ok(row)
    const other = path.join(paths.dataRoot, 'Other.ttf')
    writeTestFont(other, 'Other', 'Other-Regular')
    const preview = service.inspectRelink(row.id, other)
    assert.equal(preview.match, 'mismatch')
    await assert.rejects(() => service.applyRelink(row.id, other))
    const match = path.join(paths.dataRoot, 'Match.ttf')
    fs.copyFileSync(installedPath, match)
    const linked = await service.applyRelink(row.id, match)
    assert.equal(linked.installedPath, installedPath)
    assert.equal(fs.existsSync(installedPath), true)
  })
})

test('F01-F missing-source cleanup excludes offline entries', () => {
  const missing = entry({
    id: 'gone',
    sourcePath: '/tmp/gone.ttf',
    status: 'source-missing',
    sourceAvailability: 'missing',
  })
  const offline = entry({
    id: 'off',
    sourcePath: '/Volumes/Offline/Font.ttf',
    status: 'source-missing',
    sourceAvailability: 'offline',
  })
  assert.equal(isCleanupEligible(missing), true)
  assert.equal(isCleanupEligible(offline), false)
})

test('F02 policy flags migrate the legacy custom combination', () => {
  assert.equal(policyFromFlags(false, true), 'custom')
  assert.equal(policyFromFlags(true, false), 'install-new')
  assert.equal(createWatchFolder('/tmp/export', { policy: 'install-new-and-updates' }).autoUpdate, true)
})

test('F02 exclusions apply the same relative-path rules', () => {
  const folder = createWatchFolder('/tmp/root', { exclusions: ['Web', '*.bak'] })
  assert.equal(isExcluded(folder, '/tmp/root/Web/Family.woff2'), true)
  assert.equal(isExcluded(folder, '/tmp/root/Desktop/Family.ttf'), false)
})

test('F02-A and F02-C folder policies and uninstall intent', async () => {
  await withService(async (service, paths) => {
    const archive = path.join(paths.dataRoot, 'archive')
    const exportDir = path.join(paths.dataRoot, 'export')
    fs.mkdirSync(archive, { recursive: true })
    fs.mkdirSync(exportDir, { recursive: true })
    const archiveFont = path.join(archive, 'Archive.ttf')
    const exportFont = path.join(exportDir, 'Export.ttf')
    writeTestFont(archiveFont, 'Archive', 'Archive-Regular')
    writeTestFont(exportFont, 'Export', 'Export-Regular')
    const archiveFolder = await service.configureFolder({ root: archive, policy: 'library' })
    const exportFolder = await service.configureFolder({
      root: exportDir,
      policy: 'install-new-and-updates',
    })
    assert.equal(service.listCatalog().length, 0)
    await service.updateSettings({ onboardingCompleted: true })
    await service.startWatching(archiveFolder.folder.id)
    await service.startWatching(exportFolder.folder.id)
    const catalog = service.listCatalog()
    const archived = catalog.find((item) => item.faces[0]?.familyName === 'Archive')
    const exported = catalog.find((item) => item.faces[0]?.familyName === 'Export')
    assert.ok(archived)
    assert.ok(exported)
    assert.equal(archived.status, 'uninstalled')
    assert.equal(exported.status, 'installed')
    await service.uninstall(exported.id)
    writeTestFont(exportFont, 'Export', 'Export-Regular')
    await service.resumeFolder(exportFolder.folder.id)
    const after = service.listCatalog().find((item) => item.id === exported.id)
    assert.equal(after?.status, 'uninstalled')
  })
})

test('F03 restore keeps previous bytes and pauses updates', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'Version.ttf')
    writeTestFont(source, 'Version', 'Version-Regular')
    const imported = await service.importPaths([source])
    const first = await service.install(imported.entries[0]!.id)
    const original = fs.readFileSync(first.installedPath!)
    writeTestFont(source, 'Version', 'Version-Regular', { version: 'Version 2.000' })
    const updated = await service.reinstall(first.id)
    assert.notDeepEqual(fs.readFileSync(updated.installedPath!), original)
    const restored = await service.restoreRevision(first.id)
    assert.deepEqual(fs.readFileSync(restored.installedPath!), original)
    assert.equal(restored.updateHold, 'restore')
    assert.equal(path.resolve(restored.sourcePath), path.resolve(source))
    const activity = service.listActivity()
    assert.ok(activity.some((item) => item.action === 'restore-revision'))
    const resumed = await service.resumeUpdates(first.id)
    assert.equal(resumed.updateHold, null)
    assert.equal(resumed.updatePolicy, 'inherit')
  })
})

test('F05 planner keeps unique TTF and OTF and flags alt-format conflicts', async () => {
  await withService(async (service, paths) => {
    const ttf = path.join(paths.dataRoot, 'Unique.ttf')
    const otf = path.join(paths.dataRoot, 'Unique.otf')
    writeTestFont(ttf, 'UniqueTtf', 'UniqueTtf-Regular')
    writeTestFont(otf, 'UniqueOtf', 'UniqueOtf-Regular', { format: 'otf' })
    const plan = service.planImport([ttf, otf])
    assert.equal(plan.items.length, 2)
    assert.ok(plan.items.every((item) => item.classification === 'new'))
    const applied = await service.applyPlan(plan.id, {}, { idempotencyKey: 'drop-1' })
    assert.equal(applied.succeeded, 2)
    const again = await service.applyPlan(plan.id, {}, { idempotencyKey: 'drop-1' })
    assert.equal(again.operationId, applied.operationId)

    const altTtf = path.join(paths.dataRoot, 'Face.ttf')
    const altOtf = path.join(paths.dataRoot, 'Face.otf')
    writeTestFont(altTtf, 'Face', 'Face-Regular')
    writeTestFont(altOtf, 'Face', 'Face-Regular', { format: 'otf' })
    const first = await service.importPaths([altTtf])
    await service.install(first.entries[0]!.id)
    const conflict = classifyImportFile(altOtf, { version: 1, entries: service.listCatalog() })
    assert.equal(conflict.classification, 'alt-format')
    assert.ok(conflict.choices.includes('keep'))
    assert.ok(conflict.choices.includes('replace'))
    assert.ok(conflict.choices.includes('install-as'))
    assert.equal(conflict.choices.includes('switch'), false)
    const replacePlan = service.planImport([altOtf])
    const replaceItem = replacePlan.items.find((item) => item.classification === 'alt-format')
    assert.ok(replaceItem)
    await service.applyPlan(replacePlan.id, { [replaceItem.id]: 'replace' })
    const replaced = service.listCatalog().find((item) => item.id === first.entries[0]!.id)
    assert.equal(path.resolve(replaced?.sourcePath ?? ''), path.resolve(altOtf))
  })
})

test('F06 mixed family actions only target eligible files', async () => {
  await withService(async (service, paths) => {
    const regular = path.join(paths.dataRoot, 'Reg.ttf')
    const bold = path.join(paths.dataRoot, 'Bold.ttf')
    writeTestFont(regular, 'Mixed', 'Mixed-Regular', { style: 'Regular' })
    writeTestFont(bold, 'Mixed', 'Mixed-Bold', { style: 'Bold' })
    const imported = await service.importPaths([regular, bold])
    await service.install(imported.entries.find((item) => item.faces[0]?.styleName === 'Regular')!.id)
    const catalog = service.listCatalog()
    const on = catalog.find((item) => item.status === 'installed')!
    const off = catalog.find((item) => item.status === 'uninstalled')!
    await service.deactivate(on.id)
    const after = service.listCatalog()
    assert.equal(after.find((item) => item.id === on.id)?.status, 'deactivated')
    assert.equal(after.find((item) => item.id === off.id)?.status, 'uninstalled')
    const activity = service.listActivity()
    const deactivate = activity.find((item) => item.action === 'deactivate' && item.undoable)
    assert.ok(deactivate)
    const installed = await service.install(off.id)
    const installOp = service.listActivity().find(
      (item) => item.action === 'install' && item.items.some((row) => row.entryId === installed.id),
    )
    assert.ok(installOp)
    await service.undoOperation(installOp.id)
    assert.equal(service.listCatalog().find((item) => item.id === installed.id)?.status, 'uninstalled')
  })
})

test('F07 project membership survives relink and shared activation', async () => {
  await withService(async (service, paths) => {
    const a = path.join(paths.dataRoot, 'A.ttf')
    const b = path.join(paths.dataRoot, 'B.ttf')
    writeTestFont(a, 'Share', 'Share-Regular')
    writeTestFont(b, 'Solo', 'Solo-Regular')
    const imported = await service.importPaths([a, b])
    await service.install(imported.entries[0]!.id)
    await service.install(imported.entries[1]!.id)
    const projectA = await service.createProject('A', [imported.entries[0]!.id])
    const projectB = await service.createProject('B', [imported.entries[0]!.id, imported.entries[1]!.id])
    await service.activateProject(projectA.id)
    await service.activateProject(projectB.id)
    await service.deactivateProject(projectA.id)
    const shared = service.listCatalog().find((item) => item.id === imported.entries[0]!.id)
    assert.ok(shared)
    assert.equal(shared.status, 'installed')
    assert.equal(shared.activationOwners?.some((owner) => owner.projectId === projectA.id), false)
    assert.equal(shared.activationOwners?.some((owner) => owner.projectId === projectB.id), true)
    const moved = path.join(paths.dataRoot, 'Moved-A.ttf')
    fs.copyFileSync(a, moved)
    await service.applyRelink(imported.entries[0]!.id, moved)
    const projects = service.listProjects()
    assert.ok(projects.find((item) => item.id === projectA.id)?.members[0]?.assetId === imported.entries[0]!.id)
  })
})

test('F09 Adobe destination writes managed copies without touching macOS install', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'AdobeFace.ttf')
    writeTestFont(source, 'AdobeFace', 'AdobeFace-Regular')
    const imported = await service.importPaths([source])
    const entry = await service.install(imported.entries[0]!.id, undefined, { destinationId: 'adobe-shared' })
    const adobe = entry.installations?.find((item) => item.destinationId === 'adobe-shared')
    assert.ok(adobe)
    assert.equal(adobe.verification, 'file-present')
    assert.ok(adobe.path.startsWith(paths.adobeFontsDir))
    assert.equal(Boolean(entry.installedPath && entry.installedPath.startsWith(paths.installDir)), false)
    const neighbor = path.join(paths.adobeFontsDir, 'KeepMe.ttf')
    writeTestFont(neighbor, 'KeepMe', 'KeepMe-Regular')
    await service.install(entry.id, undefined, { destinationId: 'macos' })
    const both = service.listCatalog().find((item) => item.id === entry.id)
    assert.ok(both?.installations?.some((item) => item.destinationId === 'macos'))
    assert.ok(both?.installations?.some((item) => item.destinationId === 'adobe-shared'))
    await service.removeDestinationCopy(entry.id, 'adobe-shared')
    assert.equal(fs.existsSync(adobe.path), false)
    assert.equal(fs.existsSync(neighbor), true)
    const afterAdobe = service.listCatalog().find((item) => item.id === entry.id)
    assert.ok(afterAdobe?.installations?.some((item) => item.destinationId === 'macos' && item.verification === 'file-present'))
    assert.equal(afterAdobe?.installations?.some((item) => item.destinationId === 'adobe-shared'), false)
    assert.equal(afterAdobe?.status, 'installed')
    assert.equal(service.listActivity().find((item) => item.action === 'uninstall')?.undoable, false)
    const destinations = service.listDestinations()
    assert.ok(destinations.investigation.every((row) => row.conclusion))
  })
})

test('Mac+Adobe default install writes both managed copies', async () => {
  await withService(async (service, paths) => {
    await service.updateSettings({ defaultDestination: 'macos-and-adobe' })
    const source = path.join(paths.dataRoot, 'BothFace.ttf')
    writeTestFont(source, 'BothFace', 'BothFace-Regular')
    const imported = await service.importPaths([source])
    const entry = await service.install(imported.entries[0]!.id)
    const macos = entry.installations?.find((item) => item.destinationId === 'macos')
    const adobe = entry.installations?.find((item) => item.destinationId === 'adobe-shared')
    assert.ok(macos)
    assert.equal(macos.verification, 'file-present')
    assert.ok(entry.installedPath?.startsWith(paths.installDir))
    assert.ok(adobe)
    assert.equal(adobe.verification, 'file-present')
    assert.ok(adobe.path.startsWith(paths.adobeFontsDir))
    assert.equal(
      entry.installations?.some((item) => (item.destinationId as string) === 'macos-and-adobe'),
      false,
    )
  })
})

test('Mac+Adobe default keeps the Mac copy when Adobe is unavailable', async () => {
  await withService(async (service, paths) => {
    await service.updateSettings({ defaultDestination: 'macos-and-adobe' })
    paths.adobeFontsDir = '/Library/Application Support/Adobe/Fonts'
    const source = path.join(paths.dataRoot, 'MacKept.ttf')
    writeTestFont(source, 'MacKept', 'MacKept-Regular')
    const imported = await service.importPaths([source])
    const entry = await service.install(imported.entries[0]!.id)
    assert.ok(entry.installedPath?.startsWith(paths.installDir))
    assert.equal(
      entry.installations?.some(
        (item) => item.destinationId === 'macos' && item.verification === 'file-present',
      ),
      true,
    )
    assert.equal(
      entry.installations?.some(
        (item) => item.destinationId === 'adobe-shared' && item.verification === 'file-present',
      ),
      false,
    )
  })
})

test('explicit destinationId stays one-target when default is Mac+Adobe', async () => {
  await withService(async (service, paths) => {
    await service.updateSettings({ defaultDestination: 'macos-and-adobe' })
    const source = path.join(paths.dataRoot, 'OneTarget.ttf')
    writeTestFont(source, 'OneTarget', 'OneTarget-Regular')
    const imported = await service.importPaths([source])
    const entry = await service.install(imported.entries[0]!.id, undefined, { destinationId: 'macos' })
    assert.ok(entry.installations?.some((item) => item.destinationId === 'macos'))
    assert.equal(
      entry.installations?.some((item) => item.destinationId === 'adobe-shared'),
      false,
    )
  })
})

test('F08 web fonts are preview-only and rejected for native install', async () => {
  await withService(async (service, paths) => {
    const woff = path.join(paths.dataRoot, 'Web.woff')
    writeTestWebFont(woff, 'WebFace', 'WebFace-Regular')
    const imported = await service.importPaths([woff])
    assert.equal(imported.entries[0]!.previewOnly, true)
    await assert.rejects(() => service.install(imported.entries[0]!.id), /WOFF/)
    const opened = await service.openWith(woff)
    assert.equal(opened.previewOnly, true)
    assert.equal(opened.status, 'uninstalled')
  })
})

test('offline volume paths are distinguished from missing files', () => {
  assert.equal(
    inspectSourceAvailability('/Volumes/NotMountedHere/Fonts/Family.ttf', {
      linked: true,
      external: true,
    }),
    fs.existsSync('/Volumes') && !fs.existsSync('/Volumes/NotMountedHere') ? 'offline' : 'missing',
  )
})

test('folder relink inspect uses identity rather than basename alone', () => {
  const catalog = [
    entry({
      id: 'one',
      sourcePath: '/old/Family.ttf',
      faces: [
        {
          familyName: 'Family',
          styleName: 'Regular',
          fullName: 'Family Regular',
          postscriptName: 'Family-Regular',
          isVariable: false,
          instanceCount: 1,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
    }),
  ]
  const preview = inspectRelinkCandidate(catalog[0]!, '/old/Family.ttf')
  assert.equal(preview.match === 'missing' || preview.match === 'mismatch', true)
})

test('keep and undo preserve the installed revision', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'Keep.ttf')
    writeTestFont(source, 'Keep', 'Keep-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const original = fingerprintFile(installed.installedPath!)

    writeTestFont(source, 'Keep', 'Keep-Regular', { version: 'Version 2.000' })
    const plan = service.planImport([source])
    const kept = await service.applyPlan(plan.id, { [plan.items[0]!.id]: 'keep' })
    assert.equal(kept.succeeded, 1)
    assert.equal(fingerprintFile(service.listCatalog()[0]!.installedPath!), original)

    const replacement = service.planImport([source])
    const replaced = await service.applyPlan(replacement.id, {
      [replacement.items[0]!.id]: 'replace',
    })
    await service.undoOperation(replaced.operationId)
    const restored = service.listCatalog().find((item) => item.id === installed.id)!
    assert.equal(fingerprintFile(restored.installedPath!), original)
  })
})

test('uninstall activity names each file instead of only the family', async () => {
  await withService(async (service, paths) => {
    const regular = path.join(paths.dataRoot, 'Fenul-Regular.otf')
    const bold = path.join(paths.dataRoot, 'Fenul-Bold.otf')
    writeTestFont(regular, 'Fenul', 'Fenul-Regular', { style: 'Regular', format: 'otf' })
    writeTestFont(bold, 'Fenul', 'Fenul-Bold', { style: 'Bold', format: 'otf', weight: 700 })
    const imported = await service.importPaths([regular, bold])
    await service.installMany(imported.entries.map((item) => item.id))
    await service.uninstallMany(imported.entries.map((item) => item.id))
    const operation = service.listActivity().find((item) => item.action === 'uninstall')
    assert.equal(operation?.familyName, 'Fenul')
    assert.deepEqual(
      operation?.items.map((item) => item.label).sort(),
      ['Bold · OTF', 'Regular · OTF'],
    )
  })
})

test('uninstall retains enough data for undo', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'UndoUninstall.ttf')
    writeTestFont(source, 'UndoUninstall', 'UndoUninstall-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const original = fingerprintFile(installed.installedPath!)
    await service.uninstall(installed.id)
    const operation = service.listActivity().find((item) => item.action === 'uninstall')!
    await service.undoOperation(operation.id)
    const restored = service.listCatalog().find((item) => item.id === installed.id)!
    assert.equal(restored.status, 'installed')
    assert.equal(fingerprintFile(restored.installedPath!), original)
  })
})

test('dropped folder fonts can join a new project without becoming a watch folder', async () => {
  await withService(async (service, paths) => {
    const folder = path.join(paths.dataRoot, 'Acme Brand')
    const regular = path.join(folder, 'Brand-Regular.ttf')
    const bold = path.join(folder, 'Brand-Bold.ttf')
    writeTestFont(regular, 'Brand', 'Brand-Regular')
    writeTestFont(bold, 'Brand', 'Brand-Bold', { style: 'Bold', weight: 700 })
    const plan = service.planImport([folder])
    assert.equal(plan.items.length, 2)
    const applied = await service.applyPlan(plan.id)
    assert.equal(applied.succeeded, 2)
    assert.ok(applied.entries.every((item) => item.status === 'installed'))
    assert.ok(applied.entries.every((item) => !item.ownerFolderId))
    const project = await service.createProject(path.basename(folder), applied.entries.map((item) => item.id))
    assert.equal(project.name, 'Acme Brand')
    assert.deepEqual(
      [...project.members.map((member) => member.assetId)].sort(),
      [...applied.entries.map((item) => item.id)].sort(),
    )
    const settings = service.getSettings()
    assert.deepEqual(settings.watchFolders, [])
    assert.deepEqual(settings.folders, [])
    assert.equal(
      service.listCatalog().some((item) => item.ownerFolderId),
      false,
    )
  })
})

test('projects can be created empty and renamed', async () => {
  await withService(async (service) => {
    const empty = await service.createProject('  ')
    assert.equal(empty.name, 'Untitled project')
    assert.equal(empty.members.length, 0)
    const renamed = await service.updateProject(empty.id, { name: '  Brand  ' })
    assert.equal(renamed.name, 'Brand')
    const blank = await service.updateProject(empty.id, { name: '   ' })
    assert.equal(blank.name, 'Untitled project')
  })
})

test('active project pins block source updates', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'Pinned.ttf')
    writeTestFont(source, 'Pinned', 'Pinned-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const project = await service.createProject('Pinned', [installed.id])
    await service.updateProject(project.id, {
      pin: { assetId: installed.id, fingerprint: installed.installedFingerprint },
    })
    await service.activateProject(project.id)
    writeTestFont(source, 'Pinned', 'Pinned-Regular', { version: 'Version 2.000' })
    await assert.rejects(() => service.reinstall(installed.id), /Pinned for Pinned/)
  })
})

test('folder relink applies an explicit ambiguous selection', async () => {
  await withService(async (service, paths) => {
    const oldRoot = path.join(paths.dataRoot, 'old')
    const newRoot = path.join(paths.dataRoot, 'new')
    const source = path.join(oldRoot, 'Family.ttf')
    writeTestFont(source, 'RelinkChoice', 'RelinkChoice-Regular')
    const imported = await service.importPaths([source])
    const selected = path.join(newRoot, 'one', 'Family.ttf')
    const other = path.join(newRoot, 'two', 'Family.ttf')
    fs.mkdirSync(path.dirname(selected), { recursive: true })
    fs.mkdirSync(path.dirname(other), { recursive: true })
    fs.copyFileSync(source, selected)
    fs.copyFileSync(source, other)
    fs.rmSync(source)
    const preview = service.inspectFolderRelink(oldRoot, newRoot, true)
    assert.equal(preview.rows[0]!.status, 'ambiguous')
    const updated = await service.applyFolderRelink(oldRoot, newRoot, {
      [imported.entries[0]!.id]: selected,
    })
    assert.equal(updated.length, 1)
    assert.equal(service.listCatalog()[0]!.sourcePath, selected)
  })
})

test('restoring a revision keeps its format and can be undone', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'Versions.ttf')
    writeTestFont(source, 'Versions', 'Versions-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    writeTestFont(source, 'Versions', 'Versions-Regular', { version: 'Version 2.000' })
    const updated = await service.reinstall(installed.id)
    const restored = await service.restoreRevision(installed.id)
    assert.equal(restored.format, 'ttf')
    const restoreOperation = service.listActivity().find((item) => item.action === 'restore-revision')!
    await service.undoOperation(restoreOperation.id)
    const current = service.listCatalog().find((item) => item.id === installed.id)!
    assert.equal(current.format, 'ttf')
    assert.equal(current.installedFingerprint, updated.installedFingerprint)
  })
})
