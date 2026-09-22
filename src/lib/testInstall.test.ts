import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupCatalog } from './group'
import { showTestInstallFolder, testInstallMenuLabels, testInstallToCatalog, type TestInstallFont } from './testInstall'

function font(name: string, family: string): TestInstallFont {
  return {
    id: `ti_${name}`,
    path: `/tmp/TestInstall/${name}.otf`,
    familyName: family,
    styleName: 'Regular',
    fullName: `${family} Regular`,
    postscriptName: `${family}-Regular`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
    format: 'otf',
    mtimeMs: 1,
    size: 10,
    faces: [
      {
        familyName: family,
        styleName: 'Regular',
        fullName: `${family} Regular`,
        postscriptName: `${family}-Regular`,
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
  }
}

test('test install folder is hidden until a font exists', () => {
  assert.equal(showTestInstallFolder(0), false)
  assert.equal(showTestInstallFolder(2), true)
})

test('test install menu is uninstall only', () => {
  assert.deepEqual(testInstallMenuLabels(), ['Uninstall'])
})

test('test install fonts group by family and stay out of retail', () => {
  const entries = testInstallToCatalog([font('A', 'Reckless'), font('B', 'Reckless'), font('C', 'GT America')])
  assert.equal(entries.every((entry) => !entry.retailRelativePath), true)
  const groups = groupCatalog(entries)
  assert.deepEqual(
    groups.map((group) => group.familyName),
    ['GT America', 'Reckless'],
  )
  assert.equal(groups.find((group) => group.familyName === 'Reckless')?.entries.length, 2)
})
