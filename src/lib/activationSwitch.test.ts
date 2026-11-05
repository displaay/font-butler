import assert from 'node:assert/strict'
import { test } from 'node:test'
import { familyCardPlan } from './batch.ts'
import { catalogActivationSwitch, systemActivationSwitch } from './activationSwitch.ts'
import { groupCatalog } from './group.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

function face(familyName: string, styleName = 'Regular'): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName.replace(/\s+/g, '')}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(
  id: string,
  familyName: string,
  status: CatalogEntry['status'],
  styleName = 'Regular',
): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1000,
    status,
    faces: [face(familyName, styleName)],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
  }
}

test('an active family switch is on and deactivates', () => {
  const group = groupCatalog([entry('on', 'Active', 'installed')])[0]!
  const model = catalogActivationSwitch(group, familyCardPlan(group))
  assert.equal(model.position, 'on')
  assert.equal(model.enabled, true)
  assert.equal(model.help, 'Deactivate')
  assert.equal(model.accessibilityValue, 'On')
})

test('a deactivated family switch is off and activates', () => {
  const group = groupCatalog([entry('off', 'Inactive', 'deactivated')])[0]!
  const model = catalogActivationSwitch(group, familyCardPlan(group))
  assert.equal(model.position, 'off')
  assert.equal(model.enabled, true)
  assert.equal(model.help, 'Activate')
  assert.equal(model.accessibilityValue, 'Off')
})

test('any active style keeps the family switch on, as Cicero does outside an app folder', () => {
  const group = groupCatalog([
    entry('light', 'Mixed', 'deactivated', 'Light'),
    entry('bold', 'Mixed', 'installed', 'Bold'),
  ])[0]!
  const model = catalogActivationSwitch(group, familyCardPlan(group))
  assert.equal(model.position, 'on')
  assert.equal(model.enabled, true)
  assert.equal(model.help, 'Deactivate 1 style')
})

test('a not-installed family switch stays off and disabled', () => {
  const group = groupCatalog([entry('missing', 'Shelf', 'uninstalled')])[0]!
  const model = catalogActivationSwitch(group, familyCardPlan(group))
  assert.equal(model.position, 'off')
  assert.equal(model.enabled, false)
  assert.equal(model.help, 'Not installed')
})

test('a protected Mac font switch is on and locked', () => {
  const model = systemActivationSwitch({
    protected: true,
    writable: false,
    faces: [{ deactivated: false }],
  })
  assert.equal(model.position, 'on')
  assert.equal(model.enabled, false)
  assert.equal(model.help, 'Installed with macOS')
})

test('a writable Mac font switch can turn off', () => {
  const model = systemActivationSwitch({
    protected: false,
    writable: true,
    faces: [{ deactivated: false }],
  })
  assert.equal(model.position, 'on')
  assert.equal(model.enabled, true)
  assert.equal(model.help, 'Deactivate')
})

test('a parked writable Mac family can turn back on', () => {
  const model = systemActivationSwitch({
    protected: false,
    writable: true,
    faces: [
      { deactivated: true, managedId: 'parked-regular' },
      { deactivated: true, managedId: 'parked-bold' },
    ],
  })
  assert.equal(model.position, 'off')
  assert.equal(model.enabled, true)
  assert.equal(model.help, 'Activate 2 styles')
  assert.equal(model.accessibilityValue, 'Off')
})

test('a deactivated Mac family with no parked catalog id stays locked', () => {
  const model = systemActivationSwitch({
    protected: false,
    writable: true,
    faces: [{ deactivated: true }],
  })
  assert.equal(model.position, 'off')
  assert.equal(model.enabled, false)
  assert.equal(model.help, 'Deactivated')
})
