import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { catalogRevision, loadPlan, savePlan } from './planner.ts'
import { plansDir } from './paths.ts'
import { tempPaths } from './test-util.ts'
import type { CatalogEntry, CatalogFile, ImportPlan } from './types.ts'

function samplePlan(id = crypto.randomUUID()): ImportPlan {
  return {
    id,
    createdAt: Date.now(),
    trigger: 'import',
    expectedCatalogRevision: 1,
    items: [],
    summary: { add: 0, install: 0, unchanged: 0, review: 0, preview: 0 },
  }
}

function catalogWith(entries: Array<{ id: string; updatedAt: number }>): CatalogFile {
  return {
    version: 1,
    entries: entries as CatalogEntry[],
  }
}

test('loadPlan returns a saved UUID plan', () => {
  const paths = tempPaths('font-butler-plan-ok-')
  try {
    const plan = savePlan(paths, samplePlan())
    assert.equal(loadPlan(paths, plan.id)?.id, plan.id)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadPlan rejects path-traversal ids without reading outside plansDir', () => {
  const paths = tempPaths('font-butler-plan-traverse-')
  try {
    const dir = plansDir(paths)
    fs.mkdirSync(dir, { recursive: true })
    const evil = path.join(paths.dataRoot, 'evil.json')
    fs.writeFileSync(
      evil,
      JSON.stringify({ ...samplePlan('../evil'), id: '../evil' }),
    )
    assert.equal(loadPlan(paths, '../evil'), undefined)
    assert.equal(loadPlan(paths, '..%2fevil'), undefined)
    assert.equal(loadPlan(paths, 'a/../../../evil'), undefined)
    assert.equal(fs.existsSync(evil), true)
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('catalogRevision hashes id and updatedAt instead of summing timestamps', () => {
  const left = catalogWith([
    { id: 'a', updatedAt: 1 },
    { id: 'b', updatedAt: 2 },
  ])
  const swapped = catalogWith([
    { id: 'a', updatedAt: 2 },
    { id: 'b', updatedAt: 1 },
  ])
  assert.notEqual(catalogRevision(left), catalogRevision(swapped))
  assert.equal(typeof catalogRevision(left), 'number')
  assert.equal(catalogRevision(left), catalogRevision(left))
})
