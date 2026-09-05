import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
  adobeInvestigation,
  findUnmanagedConflicts,
  inspectDestination,
  removeManagedCopy,
  writeManagedCopy,
} from './destinations.ts'
import { tempPaths, writeTestFont } from './test-util.ts'

test('F09-A investigation names tested versions and a conclusion', () => {
  const paths = tempPaths()
  try {
    const rows = adobeInvestigation(paths)
    assert.ok(rows.some((row) => row.destination.includes('shared')))
    assert.ok(rows.every((row) => row.macos && row.conclusion))
    assert.ok(rows.some((row) => /InDesign 2025 20\.4\.1\.4/.test(row.applications)))
    assert.ok(rows.some((row) => /InDesign 2026 21\.0\.0\.192/.test(row.applications)))
    assert.ok(rows.some((row) => /Unsupported/.test(row.conclusion)))
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('F09-C managed write and remove leave unmanaged neighbors', () => {
  const paths = tempPaths()
  try {
    fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
    const neighbor = path.join(paths.adobeFontsDir, 'Unmanaged.ttf')
    const staged = path.join(paths.dataRoot, 'Staged.ttf')
    writeTestFont(neighbor, 'Neighbor', 'Neighbor-Regular')
    writeTestFont(staged, 'Managed', 'Managed-Regular')
    const dest = path.join(paths.adobeFontsDir, 'Managed.ttf')
    writeManagedCopy({
      paths,
      destinationId: 'adobe-shared',
      stagedPath: staged,
      dest,
      rollbackDir: path.join(paths.dataRoot, 'rollback'),
    })
    assert.equal(fs.existsSync(dest), true)
    assert.equal(fs.existsSync(neighbor), true)
    removeManagedCopy(paths, 'adobe-shared', dest)
    assert.equal(fs.existsSync(dest), false)
    assert.equal(fs.existsSync(neighbor), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('F09-D same-face unmanaged files are disclosed and not deleted', () => {
  const paths = tempPaths()
  try {
    fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
    const neighbor = path.join(paths.adobeFontsDir, 'Conflict.ttf')
    writeTestFont(neighbor, 'Face', 'Face-Regular')
    const conflicts = findUnmanagedConflicts(paths, 'adobe-shared', [
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
    ])
    assert.equal(conflicts.length, 1)
    assert.equal(fs.existsSync(neighbor), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('F09-E a missing Adobe destination stays unsupported', () => {
  const paths = tempPaths()
  paths.adobeFontsDir = '/Library/Application Support/Adobe/Fonts'
  const capability = inspectDestination(paths, 'adobe-shared')
  assert.equal(capability.supported, false)
  assert.ok(capability.remedy)
})
