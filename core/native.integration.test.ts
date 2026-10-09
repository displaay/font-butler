import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { awaitActivatedFont, fontPathsMatch, lookupActivatedFont } from './caches.ts'
import { realFontNative, setFontNative } from './native.ts'
import { testDesktopShell, setDesktopShell } from './reveal.ts'
import { FontButlerService } from './service.ts'
import { closeAllWatchers } from './watch.ts'
import { tempPaths, withService, writeTestFont } from './test-util.ts'

test('real Core Text activates and deactivates an isolated font', async (t) => {
  if (process.platform !== 'darwin' || process.env.FONT_BUTLER_NATIVE !== '1') {
    t.skip('requires macOS and FONT_BUTLER_NATIVE=1')
    return
  }

  const previousData = process.env.FONT_BUTLER_DATA
  const native = realFontNative()
  try {
    await withService(
      async (service, paths) => {
        process.env.FONT_BUTLER_DATA = paths.dataRoot
        setDesktopShell(testDesktopShell())
        await service.init()
        const source = path.join(paths.dataRoot, 'NativeProbe.ttf')
        writeTestFont(source, 'NativeProbe', 'NativeProbe-Regular')
        const imported = await service.importPaths([source])
        const installed = await service.install(imported.entries[0].id)
        assert.ok(installed.installedPath)
        const dest = installed.installedPath
        assert.equal(installed.status, 'installed')

        try {
          const deactivated = await service.deactivate(installed.id)
          assert.equal(deactivated.status, 'deactivated')
          const activated = await service.activate(installed.id)
          assert.equal(activated.status, 'installed')
        } finally {
          try {
            await service.uninstall(installed.id)
          } catch {
            // Fall through to a direct unregister so Core Text does not keep the probe.
          }
          if (fs.existsSync(dest)) {
            await native.unregisterFont(dest).catch(() => {})
            fs.rmSync(dest, { force: true })
          }
        }
      },
      { native, prefix: 'font-butler-native-' },
    )
  } finally {
    if (previousData === undefined) delete process.env.FONT_BUTLER_DATA
    else process.env.FONT_BUTLER_DATA = previousData
    setFontNative(null)
    setDesktopShell(null)
  }
})

test('a ~/Library/Fonts update is visible in a fresh process without logout', async (t) => {
  if (process.platform !== 'darwin' || process.env.FONT_BUTLER_NATIVE !== '1') {
    t.skip('requires macOS and FONT_BUTLER_NATIVE=1')
    return
  }

  const family = `FbProbe${crypto.randomBytes(4).toString('hex')}`
  const psName = `${family}-Regular`
  const userFonts = path.join(os.homedir(), 'Library', 'Fonts')
  const canonical = path.join(userFonts, `${family}.ttf`)
  const paths = tempPaths('font-butler-native-live-')
  paths.userFontsDir = userFonts
  paths.installDir = userFonts
  const previousData = process.env.FONT_BUTLER_DATA
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  process.env.FONT_BUTLER_DATA = paths.dataRoot
  delete process.env.FONT_BUTLER_USER_FONTS_DIR
  setFontNative(realFontNative())
  setDesktopShell(testDesktopShell())
  const service = new FontButlerService(paths)
  let live = canonical
  try {
    const source = path.join(paths.dataRoot, `${family}.ttf`)
    writeTestFont(source, family, psName, { version: 'Version 1.000' })
    const imported = await service.importPaths([source])
    assert.equal(imported.errors.length, 0, imported.errors.join('\n'))
    const entry = imported.entries[0]
    assert.ok(entry)
    const installed = await service.install(entry.id)
    assert.equal(installed.status, 'installed')
    assert.ok(installed.installedPath)
    live = installed.installedPath
    assert.equal(path.resolve(live), path.resolve(canonical))

    writeTestFont(source, family, psName, { version: 'Version 2.000' })
    const updated = await service.reinstall(installed.id)
    assert.equal(updated.status, 'installed')
    assert.ok(updated.installedPath)
    live = updated.installedPath
    const seen = await awaitActivatedFont(psName, live, { version: 'Version 2.000' })
    assert.equal(seen.postscript, psName, JSON.stringify(seen))
    assert.equal(seen.listed, true, JSON.stringify(seen))
    assert.equal(seen.family, family, JSON.stringify(seen))
    assert.match(seen.version, /2\.000/, JSON.stringify(seen))
    assert.doesNotMatch(seen.version, /1\.000/)
    assert.equal(fontPathsMatch(seen.path, live), true, JSON.stringify(seen))

    const deactivated = await service.deactivate(updated.id)
    assert.equal(deactivated.status, 'deactivated')
    assert.equal(fs.existsSync(live), false)
    const activated = await service.activate(updated.id)
    assert.equal(activated.status, 'installed')
    assert.ok(activated.installedPath)
    live = activated.installedPath
    const again = await awaitActivatedFont(psName, live, { version: 'Version 2.000' })
    assert.equal(again.postscript, psName, JSON.stringify(again))
    assert.equal(again.listed, true, JSON.stringify(again))
    assert.equal(again.family, family, JSON.stringify(again))
    assert.match(again.version, /2\.000/, JSON.stringify(again))
    assert.doesNotMatch(again.version, /1\.000/)
    assert.equal(fontPathsMatch(again.path, live), true, JSON.stringify(again))

    try {
      await service.uninstall(updated.id)
    } catch {
      // The finally block still removes the probe file.
    }
  } finally {
    if (fs.existsSync(live)) fs.rmSync(live, { force: true })
    if (fs.existsSync(canonical)) fs.rmSync(canonical, { force: true })
    service.dispose()
    await closeAllWatchers()
    setFontNative(null)
    setDesktopShell(null)
    if (previousData === undefined) delete process.env.FONT_BUTLER_DATA
    else process.env.FONT_BUTLER_DATA = previousData
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('lookupActivatedFont resolves Menlo-Regular to the system Menlo collection', async (t) => {
  if (process.platform !== 'darwin' || process.env.FONT_BUTLER_NATIVE !== '1') {
    t.skip('requires macOS and FONT_BUTLER_NATIVE=1')
    return
  }
  const lookup = await lookupActivatedFont('Menlo-Regular')
  assert.equal(lookup.ok, true, lookup.error)
  assert.equal(lookup.postscript, 'Menlo-Regular')
  assert.equal(lookup.listed, true, JSON.stringify(lookup))
  assert.equal(
    fontPathsMatch(lookup.path, '/System/Library/Fonts/Menlo.ttc'),
    true,
    JSON.stringify(lookup),
  )
})
