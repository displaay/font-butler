import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createWatchFolder } from './folders.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { withService, writeTestFont } from './test-util.ts'

test('finder import keeps the Finder path and removes the staged copy', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const folder = path.join(paths.dataRoot, 'FromFinder')
    const source = path.join(folder, 'Face.otf')
    writeTestFont(source, 'FinderFace', 'FinderFace-Regular', { format: 'otf' })
    const settings = loadSettings(paths)
    settings.folders = [createWatchFolder(folder, { id: 'finder-folder', watching: true })]
    settings.watchFolders = [path.resolve(folder)]
    saveSettings(paths, settings)
    const data = fs.readFileSync(source)
    const result = await service.importFinderFiles([
      { filename: 'Face.otf', data, sourcePath: source, size: data.length },
    ])
    assert.equal(result.entries.length, 1)
    assert.equal(result.entries[0]?.sourcePath, path.resolve(source))
    assert.equal(result.entries[0]?.ownerFolderId, 'finder-folder')
    assert.equal(result.entries[0]?.sourcePath.includes(`${path.sep}uploads${path.sep}`), false)
    assert.equal(fs.readdirSync(paths.uploadsDir).length, 0)

    const again = await service.importFinderFiles([
      { filename: 'Face.otf', data, sourcePath: source, size: data.length },
    ])
    assert.equal(again.entries.length, 1)
    assert.equal(again.entries[0]?.id, result.entries[0]?.id)
    assert.equal(again.entries[0]?.sourcePath, path.resolve(source))
    assert.equal(fs.readdirSync(paths.uploadsDir).length, 0)
    assert.equal(service.listCatalog().length, 1)

    const web = path.join(folder, 'Preview.woff2')
    fs.writeFileSync(web, Buffer.from('wOF2preview-font'))
    const skipped = await service.importFinderFiles([
      { filename: 'Preview.woff2', data: fs.readFileSync(web), sourcePath: web },
    ])
    assert.equal(skipped.entries.length, 0)
    assert.equal(skipped.ignored, 1)
    assert.equal(service.listCatalog().length, 1)
  })
})

test('finder import accepts a file larger than the 50 MB upload cap', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Big.otf')
    writeTestFont(source, 'BigFace', 'BigFace-Regular', { format: 'otf' })
    const font = fs.readFileSync(source)
    const data = Buffer.alloc(51 * 1024 * 1024)
    font.copy(data)
    const result = await service.importFinderFiles([
      { filename: 'Big.otf', data, sourcePath: source, size: data.length },
    ])
    const messages = result.errors.join('\n')
    assert.equal(/50\s?MB|400\s?MB/.test(messages), false)
    assert.equal(fs.existsSync(paths.uploadsDir) ? fs.readdirSync(paths.uploadsDir).length : 0, 0)
  })
})
