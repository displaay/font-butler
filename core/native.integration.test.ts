import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { realFontNative, setFontNative } from './native.ts'
import { testDesktopShell, setDesktopShell } from './reveal.ts'
import { withService, writeTestFont } from './test-util.ts'

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
        await service.updateSettings({ skipCacheClearOnReinstall: true })
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
