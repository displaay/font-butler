import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  entryHasActiveRetailSync,
  retailLibraryEntryVisible,
  retailListingHasLocalFile,
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
