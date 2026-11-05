import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { orthographyRequirements } from '../shared/language-coverage.ts'
import { withService, writeTestFont } from './test-util.ts'

test('same-basename uploads in one request keep distinct files and entries', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const regular = path.join(paths.dataRoot, 'Regular.ttf')
    const bold = path.join(paths.dataRoot, 'Bold.ttf')
    writeTestFont(regular, 'UploadFace', 'UploadFace-Regular')
    writeTestFont(bold, 'UploadFace', 'UploadFace-Bold', { style: 'Bold' })
    const result = await service.importUploads([
      { filename: 'Face.ttf', data: fs.readFileSync(regular) },
      { filename: 'Face.ttf', data: fs.readFileSync(bold) },
    ])
    assert.equal(result.entries.length, 2)
    assert.notEqual(result.entries[0].id, result.entries[1].id)
    assert.notEqual(result.entries[0].sourcePath, result.entries[1].sourcePath)
    assert.notDeepEqual(
      fs.readFileSync(result.entries[0].sourcePath),
      fs.readFileSync(result.entries[1].sourcePath),
    )
    assert.equal(new Set(result.entries.map((entry) => entry.faces[0]?.postscriptName)).size, 2)
  })
})

test('uploads that sanitize to the same name stay distinct', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const first = path.join(paths.dataRoot, 'First.ttf')
    const second = path.join(paths.dataRoot, 'Second.ttf')
    writeTestFont(first, 'Sanitized', 'Sanitized-Regular')
    writeTestFont(second, 'Sanitized', 'Sanitized-Bold', { style: 'Bold' })
    const result = await service.importUploads([
      { filename: 'Face Name.ttf', data: fs.readFileSync(first) },
      { filename: 'Face_Name.ttf', data: fs.readFileSync(second) },
    ])
    assert.equal(result.entries.length, 2)
    assert.notEqual(result.entries[0].sourcePath, result.entries[1].sourcePath)
    assert.ok(result.entries.every((entry) => fs.existsSync(entry.sourcePath)))
  })
})

test('re-importing the same font keeps completed language coverage', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const [english] = orthographyRequirements('eng')
    assert.ok(english)
    const source = path.join(paths.dataRoot, 'Covered.ttf')
    writeTestFont(source, 'Covered', 'Covered-Regular', { codePoints: [...english] })
    const first = await service.importPaths([source])
    assert.equal(first.entries[0]?.faces[0]?.languages?.includes('eng'), true)

    const copy = path.join(paths.dataRoot, 'Covered-copy.ttf')
    fs.copyFileSync(source, copy)
    const second = await service.importPaths([copy])
    assert.equal(second.entries.length, 1)
    assert.equal(second.entries[0]?.id, first.entries[0]?.id)
    assert.equal(second.entries[0]?.faces[0]?.languages?.includes('eng'), true)
  })
})
