import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createWatchFolder } from './folders.ts'
import { fingerprintFile } from './fingerprint.ts'
import { IDENTITY_MUTEX_MESSAGE } from './identity.ts'
import { recordedDestinationIds } from './destinations.ts'
import { noopFontNative } from './native.ts'
import { isFontFile, parseFontFile } from './parse.ts'
import {
  classifyImportFile,
  defaultChoiceForPolicy,
  planNeedsReview,
} from './planner.ts'
import { withService, writeTestFont } from './test-util.ts'

function liveFonts(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => {
      try {
        return fs.statSync(file).isFile() && isFontFile(file)
      } catch {
        return false
      }
    })
}

test('deactivate parks managed bytes out of the install dir', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Release.ttf')
    writeTestFont(source, 'Release', 'Release-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const dest = installed.installedPath!
    assert.equal(fs.existsSync(dest), true)

    const parked = await service.deactivate(installed.id)
    assert.equal(parked.status, 'deactivated')
    assert.equal(fs.existsSync(dest), false)
    assert.ok(parked.disabledPath)
    assert.equal(fs.existsSync(parked.disabledPath), true)
    assert.ok(path.resolve(parked.disabledPath).startsWith(path.resolve(paths.disabledDir)))
    assert.equal(liveFonts(paths.installDir).length, 0)
  })
})

test('two active same-identity installs are impossible and activate without switch fails', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    const wip = path.join(paths.dataRoot, 'WIP.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    writeTestFont(wip, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)

    const plan = service.planImport([wip])
    const item = plan.items[0]!
    assert.equal(item.parallelCopy, true)
    assert.ok(item.choices.includes('add-inactive'))
    assert.ok(item.choices.includes('install-as'))
    assert.ok(item.choices.includes('replace'))
    assert.ok(item.choices.includes('skip'))
    assert.equal(planNeedsReview(plan), true)
    assert.equal(
      defaultChoiceForPolicy(item, { installNew: true, autoUpdate: true }),
      'skip',
    )

    const added = await service.applyPlan(plan.id, { [item.id]: 'add-inactive' })
    assert.equal(added.succeeded, 1)
    const catalog = service.listCatalog()
    assert.equal(catalog.length, 2)
    const inactive = catalog.find((entry) => entry.id !== first.id)!
    assert.equal(inactive.status, 'uninstalled')
    assert.equal(service.listCatalog().find((entry) => entry.id === first.id)?.status, 'installed')
    assert.equal(liveFonts(paths.installDir).length, 1)

    await assert.rejects(() => service.activate(inactive.id), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /already active/)
      return true
    })
    await assert.rejects(() => service.install(inactive.id), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /already active|Switch/)
      return true
    })
    assert.equal(liveFonts(paths.installDir).length, 1)
    assert.equal(IDENTITY_MUTEX_MESSAGE.includes('already active'), true)
  })
})

test('switch parks the release, installs the WIP copy, and can switch back', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    const wip = path.join(paths.dataRoot, 'WIP.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    writeTestFont(wip, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    const first = (await service.importPaths([release])).entries[0]!
    const installed = await service.install(first.id)
    const releaseBytes = fs.readFileSync(installed.installedPath!)
    const plan = service.planImport([wip])
    await service.applyPlan(plan.id, { [plan.items[0]!.id]: 'add-inactive' })
    const inactive = service.listCatalog().find((entry) => entry.id !== first.id)!

    const switched = await service.switchTo(inactive.id)
    assert.equal(switched.status, 'installed')
    assert.equal(switched.id, inactive.id)
    const after = service.listCatalog()
    const parked = after.find((entry) => entry.id === first.id)!
    assert.equal(parked.status, 'deactivated')
    assert.ok(parked.disabledPath)
    assert.equal(fs.existsSync(parked.disabledPath), true)
    assert.equal(liveFonts(paths.installDir).length, 1)
    const live = liveFonts(paths.installDir)[0]!
    assert.equal(fingerprintFile(live), fingerprintFile(wip))

    const back = await service.switchTo(first.id)
    assert.equal(back.id, first.id)
    assert.equal(back.status, 'installed')
    assert.deepEqual(fs.readFileSync(back.installedPath!), releaseBytes)
    assert.equal(service.listCatalog().find((entry) => entry.id === inactive.id)?.status, 'deactivated')
    assert.equal(liveFonts(paths.installDir).length, 1)
  })
})

test('failure mid-switch restores the previously active copy', async () => {
  await withService(
    async (service, paths) => {
      await service.init()
      const release = path.join(paths.dataRoot, 'Release.ttf')
      const wip = path.join(paths.dataRoot, 'WIP.ttf')
      writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
      writeTestFont(wip, 'Release', 'Release-Regular', { version: 'Version 2.000' })
      const first = (await service.importPaths([release])).entries[0]!
      const installed = await service.install(first.id)
      const releaseDest = installed.installedPath!
      const releaseBytes = fs.readFileSync(releaseDest)
      const plan = service.planImport([wip])
      await service.applyPlan(plan.id, { [plan.items[0]!.id]: 'add-inactive' })
      const inactive = service.listCatalog().find((entry) => entry.id !== first.id)!

      await assert.rejects(() => service.switchTo(inactive.id), /Could not register/)
      const restored = service.listCatalog().find((entry) => entry.id === first.id)!
      assert.equal(restored.status, 'installed')
      assert.equal(fs.existsSync(releaseDest), true)
      assert.deepEqual(fs.readFileSync(releaseDest), releaseBytes)
      assert.equal(liveFonts(paths.installDir).length, 1)
    },
    {
      native: noopFontNative({
        async registerFont(filePath) {
          if (path.basename(filePath).toLowerCase().includes('wip')) {
            return { ok: false, native: false, error: 'Could not register the font.' }
          }
          return { ok: true, native: false }
        },
      }),
    },
  )
})

test('watch folder same-identity files queue Duplicates and do not auto-replace', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)
    const releaseBytes = fs.readFileSync(service.listCatalog().find((entry) => entry.id === first.id)!.installedPath!)

    const inbox = path.join(paths.dataRoot, 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    const unique = path.join(inbox, 'Unique.ttf')
    const duplicate = path.join(inbox, 'WIP.ttf')
    writeTestFont(unique, 'UniqueWatch', 'UniqueWatch-Regular')
    writeTestFont(duplicate, 'Release', 'Release-Regular', { version: 'Version 2.000' })

    await service.updateSettings({
      folders: [
        createWatchFolder(inbox, { policy: 'install-new-and-updates', watching: true }),
      ],
    })

    const catalog = service.listCatalog()
    assert.ok(catalog.some((entry) => entry.faces[0]?.familyName === 'UniqueWatch' && entry.status === 'installed'))
    assert.equal(catalog.filter((entry) => entry.faces[0]?.postscriptName === 'Release-Regular').length, 1)
    const warnings = service.listDuplicates()
    assert.equal(warnings.length, 1)
    assert.equal(path.resolve(warnings[0]!.path), path.resolve(duplicate))
    assert.deepEqual(
      fs.readFileSync(service.listCatalog().find((entry) => entry.id === first.id)!.installedPath!),
      releaseBytes,
    )

    const again = await service.updateSettings({
      folders: [
        createWatchFolder(inbox, {
          id: service.getSettings().folders[0]?.id,
          policy: 'install-new-and-updates',
          watching: true,
        }),
      ],
    })
    assert.equal(again.folders.length, 1)
    assert.equal(service.listDuplicates().length, 1)

    const resolved = await service.resolveDuplicate(warnings[0]!.id, 'add-inactive')
    assert.equal(service.listDuplicates().length, 0)
    assert.equal(resolved.entries[0]?.status, 'uninstalled')
    assert.equal(service.listCatalog().find((entry) => entry.id === first.id)?.status, 'installed')
    assert.equal(
      service.listCatalog().filter((entry) => entry.faces[0]?.postscriptName === 'Release-Regular').length,
      2,
    )
  })
})

test('Install as from a parallel copy installs a renamed face alongside the release', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    const wip = path.join(paths.dataRoot, 'WIP.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    writeTestFont(wip, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)
    const originalSource = parseFontFile(wip)
    assert.equal(originalSource.faces[0]?.familyName, 'Release')

    const plan = service.planImport([wip])
    const item = plan.items[0]!
    assert.ok(item.choices.includes('install-as'))
    const applied = await service.applyPlan(plan.id, { [item.id]: 'install-as' }, { familyName: 'Release WIP' })
    assert.equal(applied.succeeded, 1)
    const renamed = applied.entries.find((entry) => entry.status === 'installed' && entry.id !== first.id)
    assert.ok(renamed)
    assert.equal(renamed.faces[0]?.familyName, 'Release WIP')
    assert.equal(service.listCatalog().find((entry) => entry.id === first.id)?.status, 'installed')
    assert.equal(liveFonts(paths.installDir).length, 2)
    assert.equal(parseFontFile(wip).faces[0]?.familyName, 'Release')
  })
})

test('Duplicates review Install as installs a renamed copy without replacing the release', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)

    const inbox = path.join(paths.dataRoot, 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    const duplicate = path.join(inbox, 'WIP.ttf')
    writeTestFont(duplicate, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    await service.updateSettings({
      folders: [createWatchFolder(inbox, { policy: 'install-new-and-updates', watching: true })],
    })
    const warning = service.listDuplicates()[0]!
    const result = await service.resolveDuplicate(warning.id, 'install-as', { familyName: 'Release Test' })
    assert.equal(service.listDuplicates().length, 0)
    const renamed = result.entries.find((entry) => entry.faces[0]?.familyName === 'Release Test')
    assert.ok(renamed)
    assert.equal(renamed.status, 'installed')
    assert.equal(service.listCatalog().find((entry) => entry.id === first.id)?.status, 'installed')
    assert.equal(liveFonts(paths.installDir).length, 2)
    assert.equal(parseFontFile(duplicate).faces[0]?.familyName, 'Release')
  })
})

test('bound-path source updates stay keep/replace, not add-inactive', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Bound.ttf')
    writeTestFont(source, 'Bound', 'Bound-Regular', { version: 'Version 1.000' })
    const imported = await service.importPaths([source])
    await service.install(imported.entries[0]!.id)
    writeTestFont(source, 'Bound', 'Bound-Regular', { version: 'Version 2.000' })
    const item = classifyImportFile(source, { version: 1, entries: service.listCatalog() }, { paths })
    assert.equal(item.classification, 'revision')
    assert.equal(item.parallelCopy, false)
    assert.deepEqual(item.choices, ['keep', 'replace', 'skip'])
  })
})

test('switch parks a Mac+Adobe release without placing a Mac-only WIP on Adobe', async () => {
  await withService(async (service, paths) => {
    await service.init()
    await service.updateSettings({ defaultDestination: 'macos-and-adobe' })
    const release = path.join(paths.dataRoot, 'Release.ttf')
    const wip = path.join(paths.dataRoot, 'WIP.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    writeTestFont(wip, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    const first = (await service.importPaths([release])).entries[0]!
    const installed = await service.install(first.id)
    assert.ok(installed.installations?.some((item) => item.destinationId === 'macos'))
    assert.ok(installed.installations?.some((item) => item.destinationId === 'adobe-shared'))
    const adobePath = installed.installations?.find((item) => item.destinationId === 'adobe-shared')?.path
    assert.ok(adobePath)

    const plan = service.planImport([wip])
    await service.applyPlan(plan.id, { [plan.items[0]!.id]: 'add-inactive' })
    const inactive = service.listCatalog().find((entry) => entry.id !== first.id)!
    assert.deepEqual(recordedDestinationIds(inactive), ['macos'])

    const switched = await service.switchTo(inactive.id)
    assert.equal(switched.status, 'installed')
    assert.deepEqual(recordedDestinationIds(switched), ['macos'])
    assert.ok(switched.installations?.some((item) => item.destinationId === 'macos'))
    assert.equal(
      switched.installations?.some((item) => item.destinationId === 'adobe-shared'),
      false,
    )
    assert.equal(liveFonts(paths.adobeFontsDir).length, 0)
    assert.equal(liveFonts(paths.installDir).length, 1)
    assert.equal(fingerprintFile(liveFonts(paths.installDir)[0]!), fingerprintFile(wip))
    const parked = service.listCatalog().find((entry) => entry.id === first.id)!
    assert.equal(parked.status, 'deactivated')
    const adobeParked = parked.installations?.find((item) => item.destinationId === 'adobe-shared')
    assert.ok(adobeParked?.parkedPath && fs.existsSync(adobeParked.parkedPath))
    assert.deepEqual(recordedDestinationIds(parked), ['macos', 'adobe-shared'])

    const restored = await service.switchTo(first.id)
    assert.equal(restored.id, first.id)
    assert.ok(restored.installations?.some((item) => item.destinationId === 'adobe-shared'))
    const restoredAdobe = restored.installations?.find((item) => item.destinationId === 'adobe-shared')?.path
    assert.ok(restoredAdobe && fs.existsSync(restoredAdobe))
    assert.equal(liveFonts(paths.adobeFontsDir).length, 1)
    assert.equal(fingerprintFile(liveFonts(paths.adobeFontsDir)[0]!), fingerprintFile(release))
    assert.equal(liveFonts(paths.installDir).length, 1)
    assert.equal(
      service.listCatalog().find((entry) => entry.id === inactive.id)?.installations?.some(
        (item) => item.destinationId === 'adobe-shared',
      ),
      false,
    )
  })
})

test('unparking an Adobe copy does not overwrite a file already at the destination', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'AdobeOnly.ttf')
    writeTestFont(source, 'AdobeOnly', 'AdobeOnly-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id, undefined, {
      destinationId: 'adobe-shared',
    })
    const adobe = installed.installations?.find((item) => item.destinationId === 'adobe-shared')
    assert.ok(adobe?.path)
    const dest = adobe.path
    await service.deactivate(installed.id)
    assert.equal(fs.existsSync(dest), false)
    const parked = service.listCatalog().find((entry) => entry.id === installed.id)!
    const vault = parked.installations?.find((item) => item.destinationId === 'adobe-shared')?.parkedPath
    assert.ok(vault && fs.existsSync(vault))
    const vaultBytes = fs.readFileSync(vault)
    writeTestFont(dest, 'Unmanaged', 'Unmanaged-Regular')
    const unmanagedBytes = fs.readFileSync(dest)

    await assert.rejects(() => service.activate(installed.id), /already active/)
    assert.deepEqual(fs.readFileSync(dest), unmanagedBytes)
    assert.equal(fs.existsSync(vault), true)
    assert.deepEqual(fs.readFileSync(vault), vaultBytes)
    assert.equal(service.listCatalog().find((entry) => entry.id === installed.id)?.status, 'deactivated')
  })
})
