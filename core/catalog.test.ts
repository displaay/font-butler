import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  applySourcePresence,
  faceIdentityKey,
  findByFaceIdentity,
  resolveStatusWhenSourceMissing,
} from './catalog.ts'
import type { CatalogEntry, CatalogFile, FontFaceInfo } from './types.ts'

function face(postscriptName: string, familyName = 'Test'): FontFaceInfo {
  return {
    familyName,
    styleName: 'Regular',
    fullName: `${familyName} Regular`,
    postscriptName,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'sourcePath'>): CatalogEntry {
  return {
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'uninstalled',
    faces: [face('Test-Regular')],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('faceIdentityKey sorts postscript names and ignores empty names', () => {
  assert.equal(faceIdentityKey([face('B'), face('A')]), 'A\0B')
  assert.equal(faceIdentityKey([face('')]), null)
  assert.equal(faceIdentityKey([face('A'), face('')]), null)
})

test('findByFaceIdentity matches the same faces from another path', () => {
  const catalog: CatalogFile = {
    version: 1,
    entries: [entry({ id: 'one', sourcePath: '/tmp/old.ttf', faces: [face('Dup-Regular')] })],
  }
  const match = findByFaceIdentity(catalog, [face('Dup-Regular')])
  assert.equal(match?.id, 'one')
  assert.equal(findByFaceIdentity(catalog, [face('Other-Regular')]), undefined)
})

test('resolveStatusWhenSourceMissing keeps installed and deactivated copies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-catalog-'))
  try {
    const installed = path.join(root, 'Installed.ttf')
    const disabled = path.join(root, 'Disabled.ttf')
    fs.writeFileSync(installed, 'font')
    fs.writeFileSync(disabled, 'font')
    assert.equal(
      resolveStatusWhenSourceMissing(
        entry({ id: 'in', sourcePath: '/missing.ttf', status: 'installed', installedPath: installed }),
      ),
      'installed',
    )
    assert.equal(
      resolveStatusWhenSourceMissing(
        entry({ id: 'off', sourcePath: '/missing.ttf', status: 'deactivated', disabledPath: disabled }),
      ),
      'deactivated',
    )
    assert.equal(
      resolveStatusWhenSourceMissing(entry({ id: 'gone', sourcePath: '/missing.ttf', status: 'uninstalled' })),
      'source-missing',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('applySourcePresence does not uninstall a font when the source file disappears', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-catalog-'))
  try {
    const installed = path.join(root, 'Installed.ttf')
    fs.writeFileSync(installed, 'font')
    const row = entry({
      id: 'keep',
      sourcePath: path.join(root, 'gone.ttf'),
      status: 'installed',
      installedPath: installed,
      sourcePresent: true,
    })
    assert.equal(applySourcePresence(row), true)
    assert.equal(row.status, 'installed')
    assert.equal(row.sourcePresent, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
