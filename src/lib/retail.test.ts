import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  entryHasActiveRetailSync,
  isOrphanRetailListing,
  isRetailSyncingStatusMessage,
  retailFamiliesOffInstalled,
  retailFamiliesOffNeedsChoice,
  retailListingOnMac,
  retailSyncInProgress,
  isRetailVariableFamilyName,
  matchesRetailFontKindFilter,
  matchesRetailFontQuery,
  nextDisabledRetailFamilyNames,
  retailLibraryEntryVisible,
  retailListingHasLocalFile,
  retailSyncFamilyProgress,
  retailSyncIsOn,
  retailSyncingStatusMessage,
  retailUpdateCount,
  retailHasLiveUpdates,
  type RetailSyncFont,
} from '../../shared/retail.ts'

function font(familyName: string, extra: Partial<RetailSyncFont> = {}): RetailSyncFont {
  return {
    familyName,
    typefaceName: familyName,
    glyphsFile: familyName,
    fileCount: 1,
    enabled: true,
    available: true,
    formats: ['otf'],
    selectedFormat: 'otf',
    ...extra,
  }
}

const stub = {
  retailRelativePath: 'Reckless/Reckless-Regular.otf',
  retailFamilyName: 'Reckless',
  faces: [{ familyName: 'Reckless' }],
  sourcePath: '',
  sourcePresent: false,
}

const installed = {
  ...stub,
  installedPath: '/Library/Fonts/Reckless-Regular.otf',
  sourcePresent: false,
  installations: [
    {
      path: '/Library/Fonts/Reckless-Regular.otf',
      verification: 'file-present' as const,
    },
  ],
}

const parked = {
  ...stub,
  disabledPath: '/Library/Fonts/.Font Buttler Parked/Reckless-Regular.otf',
}

const localSource = {
  ...stub,
  sourcePath: '/Users/you/Fonts/Reckless-Regular.otf',
  sourcePresent: true,
}

test('active retail sync is false when sync is off or the family is disabled', () => {
  assert.equal(entryHasActiveRetailSync(stub), false)
  assert.equal(
    entryHasActiveRetailSync(stub, { enabled: false, fonts: [font('Reckless')], disabledGlyphsFiles: [] }),
    false,
  )
  assert.equal(
    entryHasActiveRetailSync(stub, {
      enabled: true,
      fonts: [font('Reckless', { enabled: false })],
      disabledGlyphsFiles: ['Reckless'],
    }),
    false,
  )
  assert.equal(
    entryHasActiveRetailSync(stub, { enabled: true, fonts: [font('Reckless')], disabledGlyphsFiles: [] }),
    true,
  )
  assert.equal(
    entryHasActiveRetailSync(
      { ...stub, retailRelativePath: null },
      { enabled: true, fonts: [font('Reckless')], disabledGlyphsFiles: [] },
    ),
    false,
  )
  assert.equal(
    entryHasActiveRetailSync(stub, { enabled: true, fonts: [], disabledGlyphsFiles: [] }),
    false,
  )
})

test('unknown retail status is treated as off so file-less stubs stay hidden', () => {
  assert.equal(retailSyncIsOn(null), false)
  assert.equal(retailSyncIsOn(undefined), false)
  assert.equal(retailSyncIsOn({ enabled: false }), false)
  assert.equal(retailSyncIsOn({ enabled: true }), true)
  assert.equal(retailLibraryEntryVisible(stub, [], retailSyncIsOn(null)), false)
  assert.equal(retailLibraryEntryVisible(stub, [], true), false)
})

test('file-less retail stubs stay hidden while the family is Off', () => {
  const off = [font('Reckless', { enabled: false })]
  assert.equal(retailLibraryEntryVisible(stub, off, true), false)
  assert.equal(retailLibraryEntryVisible(installed, off, true), true)
})

test('file-less retail listings are orphans only after sync is off', () => {
  assert.equal(isOrphanRetailListing(stub, false), true)
  assert.equal(isOrphanRetailListing(stub, true), false)
  assert.equal(isOrphanRetailListing({ ...stub, retailRelativePath: null }, false), false)
  assert.equal(isOrphanRetailListing(installed, false), false)
})

test('file-less retail stubs hide when sync is off; installed and local entries stay visible', () => {
  const fonts = [font('Reckless')]
  assert.equal(retailLibraryEntryVisible(stub, fonts, false), false)
  assert.equal(retailLibraryEntryVisible(installed, fonts, false), true)
  assert.equal(retailLibraryEntryVisible(parked, fonts, false), true)
  assert.equal(retailLibraryEntryVisible(localSource, fonts, false), true)
  assert.equal(
    retailLibraryEntryVisible({ faces: [{ familyName: 'Local' }], sourcePath: '/tmp/Local.otf' }, fonts, false),
    true,
  )
  assert.equal(retailLibraryEntryVisible(stub, fonts, true), true)
  assert.equal(
    retailLibraryEntryVisible(
      { ...stub, installedPath: '/Library/Fonts/Reckless-Regular.otf' },
      fonts,
      false,
    ),
    false,
  )
  const stale = {
    ...stub,
    installedPath: '/Library/Fonts/Reckless-Regular.otf',
    installations: [
      {
        path: '/Library/Fonts/Reckless-Regular.otf',
        verification: 'unavailable' as const,
      },
    ],
  }
  assert.equal(retailListingHasLocalFile(stale), false)
  assert.equal(retailListingHasLocalFile({ ...stub, installedPath: '/Library/Fonts/Reckless-Regular.otf' }), false)
  const parkedUnavailable = {
    ...stub,
    disabledPath: '/Library/Fonts/.Font Buttler Parked/Reckless-Regular.otf',
    installations: [
      {
        path: '/Library/Fonts/Reckless-Regular.otf',
        parkedPath: '/Library/Fonts/.Font Buttler Parked/Reckless-Regular.otf',
        verification: 'unavailable' as const,
      },
    ],
  }
  assert.equal(retailLibraryEntryVisible(parkedUnavailable, fonts, false), true)
  const adobeOnly = {
    ...stub,
    installations: [
      {
        path: '/Library/Application Support/Adobe/Fonts/Reckless-Regular.otf',
        verification: 'file-present' as const,
      },
    ],
  }
  assert.equal(retailLibraryEntryVisible(adobeOnly, fonts, false), true)
  const offlineSource = {
    ...stub,
    sourcePath: '/Volumes/Offline/Reckless-Regular.otf',
    sourcePresent: true,
    sourceAvailability: 'offline' as const,
  }
  assert.equal(retailListingHasLocalFile(offlineSource), false)
  assert.equal(retailLibraryEntryVisible(offlineSource, fonts, false), false)
  const unreadableSource = {
    ...stub,
    sourcePath: '/Users/you/Fonts/Reckless-Regular.otf',
    sourcePresent: true,
    sourceAvailability: 'unreadable' as const,
  }
  assert.equal(retailListingHasLocalFile(unreadableSource), false)
  assert.equal(
    retailListingHasLocalFile({
      ...localSource,
      sourceAvailability: 'present',
    }),
    true,
  )
})

test('when sync is on, unselected retail formats stay hidden', () => {
  const fonts = [font('Azeret', { formats: ['otf', 'ttf'], selectedFormat: 'otf' })]
  const otf = {
    retailRelativePath: 'Azeret/Azeret-Regular.otf',
    retailFamilyName: 'Azeret',
    sourcePath: '',
    sourcePresent: false,
  }
  const ttf = {
    retailRelativePath: 'Azeret/Azeret-Regular.ttf',
    retailFamilyName: 'Azeret',
    sourcePath: '',
    sourcePresent: false,
  }
  assert.equal(retailLibraryEntryVisible(otf, fonts, true), true)
  assert.equal(retailLibraryEntryVisible(ttf, fonts, true), false)
  assert.equal(
    retailLibraryEntryVisible(
      {
        ...ttf,
        installedPath: '/Library/Fonts/Azeret-Regular.ttf',
        installations: [
          {
            path: '/Library/Fonts/Azeret-Regular.ttf',
            verification: 'file-present' as const,
          },
        ],
      },
      fonts,
      false,
    ),
    true,
  )
})

test('retail sync progress counts families, not styles', () => {
  const todo = [
    { relativePath: 'Aguzzo/A.otf', familyName: 'Aguzzo' },
    { relativePath: 'Aguzzo/B.otf', familyName: 'Aguzzo' },
    { relativePath: 'Vinila/V.otf', familyName: 'Vinila' },
  ]
  assert.deepEqual(retailSyncFamilyProgress(todo, new Set()), { done: 0, total: 2 })
  assert.deepEqual(retailSyncFamilyProgress(todo, new Set(['Aguzzo/A.otf'])), { done: 0, total: 2 })
  assert.deepEqual(
    retailSyncFamilyProgress(todo, new Set(['Aguzzo/A.otf', 'Aguzzo/B.otf'])),
    { done: 1, total: 2 },
  )
  assert.deepEqual(
    retailSyncFamilyProgress(todo, new Set(['Aguzzo/A.otf', 'Aguzzo/B.otf', 'Vinila/V.otf'])),
    { done: 2, total: 2 },
  )
})

test('the syncing status message includes the family count', () => {
  assert.equal(retailSyncingStatusMessage(), 'Syncing Displaay retail…')
  assert.equal(retailSyncingStatusMessage(null), 'Syncing Displaay retail…')
  assert.equal(retailSyncingStatusMessage({ done: 0, total: 0 }), 'Syncing Displaay retail…')
  assert.equal(retailSyncingStatusMessage({ done: 12, total: 36 }), 'Syncing Displaay retail… 12/36')
})

test('isRetailVariableFamilyName follows VF in the family name', () => {
  assert.equal(isRetailVariableFamilyName('Aguzzo VF'), true)
  assert.equal(isRetailVariableFamilyName('Aguzzo Italic VF'), true)
  assert.equal(isRetailVariableFamilyName('AguzzoVF'), true)
  assert.equal(isRetailVariableFamilyName('Aguzzo'), false)
  assert.equal(isRetailVariableFamilyName('Aguzzo Italic'), false)
  assert.equal(matchesRetailFontKindFilter(font('Aguzzo VF'), 'variable'), true)
  assert.equal(matchesRetailFontKindFilter(font('Aguzzo'), 'variable'), false)
  assert.equal(matchesRetailFontKindFilter(font('Aguzzo VF'), 'static'), false)
  assert.equal(matchesRetailFontKindFilter(font('Aguzzo'), 'static'), true)
  assert.equal(matchesRetailFontKindFilter(font('Aguzzo VF'), 'all'), true)
})

test('matchesRetailFontQuery filters families by name', () => {
  assert.equal(matchesRetailFontQuery(font('Aguzzo VF', { typefaceName: 'Aguzzo' }), ''), true)
  assert.equal(matchesRetailFontQuery(font('Aguzzo VF', { typefaceName: 'Aguzzo' }), 'aguzzo'), true)
  assert.equal(matchesRetailFontQuery(font('Aguzzo Italic VF', { typefaceName: 'Aguzzo Italic' }), 'italic'), true)
  assert.equal(matchesRetailFontQuery(font('Reckless', { typefaceName: 'Reckless' }), 'aguzzo'), false)
})

test('nextDisabledRetailFamilyNames keeps hidden families as they are', () => {
  const fonts = [
    font('Aguzzo', { enabled: false }),
    font('Aguzzo VF', { enabled: false }),
    font('Reckless', { enabled: true }),
  ]
  assert.deepEqual(nextDisabledRetailFamilyNames(fonts, ['Aguzzo', 'Aguzzo VF'], true), [])
  assert.deepEqual(nextDisabledRetailFamilyNames(fonts, ['Aguzzo', 'Aguzzo VF'], false), [
    'Aguzzo',
    'Aguzzo VF',
  ])
  assert.deepEqual(nextDisabledRetailFamilyNames(fonts, ['Reckless'], false), [
    'Aguzzo',
    'Aguzzo VF',
    'Reckless',
  ])
  assert.deepEqual(nextDisabledRetailFamilyNames(fonts, fonts.map((item) => item.familyName), true), [])
  assert.deepEqual(
    nextDisabledRetailFamilyNames(
      [font('Aguzzo', { enabled: false }), font('Reckless', { enabled: false })],
      ['Aguzzo'],
      true,
    ),
    ['Reckless'],
  )
})

test('retailUpdateCount uses remaining families while a sync is in flight', () => {
  assert.equal(retailUpdateCount(null), 0)
  assert.equal(retailUpdateCount({ pending: 40 }), 40)
  assert.equal(retailUpdateCount({ pending: 40, progress: null }), 40)
  assert.equal(retailUpdateCount({ pending: 40, progress: { done: 12, total: 36 } }), 24)
  assert.equal(retailUpdateCount({ pending: 40, progress: { done: 36, total: 36 } }), 0)
  assert.equal(retailHasLiveUpdates({ pending: 0, progress: { done: 36, total: 36 } }), true)
  assert.equal(retailHasLiveUpdates({ pending: 0, progress: null }), false)
  assert.equal(retailHasLiveUpdates({ pending: 3 }), true)
})

const cacheParked = {
  ...stub,
  status: 'uninstalled',
  sourcePath: '/Users/you/Library/Application Support/Font Buttler/retail-cache/Reckless/Reckless-Regular.otf',
  sourcePresent: true,
  sourceAvailability: 'present' as const,
}

test('a not-installed listing parked in the retail cache is hidden once its family is off', () => {
  assert.equal(retailListingHasLocalFile(cacheParked), true)
  assert.equal(retailListingOnMac(cacheParked), false)
  assert.equal(retailLibraryEntryVisible(cacheParked, [font('Reckless', { enabled: false })], true), false)
  assert.equal(retailLibraryEntryVisible(cacheParked, [font('Reckless')], false), false)
  assert.equal(retailLibraryEntryVisible(cacheParked, [font('Reckless')], true), true)
  assert.equal(isOrphanRetailListing(cacheParked, false), true)
  assert.equal(retailListingOnMac({ ...installed, status: 'installed' }), true)
  assert.equal(retailListingOnMac({ ...parked, status: 'deactivated' }), true)
})

test('None asks keep-or-uninstall only while syncing or over installed families still syncing', () => {
  const fonts = [font('Reckless'), font('Zangezi'), font('Aguzzo', { enabled: false })]
  const onMac = new Set(['Zangezi', 'Aguzzo'])
  const idle = { progress: null }
  const syncing = { progress: { done: 1, total: 3 } }
  assert.equal(retailFamiliesOffNeedsChoice(fonts, ['Reckless'], idle, onMac), false)
  assert.equal(retailFamiliesOffNeedsChoice(fonts, ['Reckless'], syncing, onMac), true)
  assert.equal(retailFamiliesOffNeedsChoice(fonts, ['Reckless', 'Zangezi'], idle, onMac), true)
  assert.equal(retailFamiliesOffNeedsChoice(fonts, ['Aguzzo'], syncing, onMac), false, 'already off')
  assert.equal(retailFamiliesOffInstalled(fonts, ['Reckless', 'Zangezi', 'Aguzzo'], onMac), 1)
})

test('the syncing status is recognised and ends with any status that has no progress', () => {
  assert.equal(isRetailSyncingStatusMessage(retailSyncingStatusMessage({ done: 2, total: 9 })), true)
  assert.equal(isRetailSyncingStatusMessage(retailSyncingStatusMessage()), true)
  assert.equal(isRetailSyncingStatusMessage('Installing Inter…'), false)
  assert.equal(isRetailSyncingStatusMessage(null), false)
  assert.equal(retailSyncInProgress({ progress: { done: 0, total: 3 } }), true)
  assert.equal(retailSyncInProgress({ progress: null }), false)
  assert.equal(retailSyncInProgress({ progress: { done: 0, total: 0 } }), false)
  assert.equal(retailSyncInProgress(null), false)
})
