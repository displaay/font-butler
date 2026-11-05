import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ANNOUNCEMENTS, WHATS_NEW_PAGES } from '../../shared/announcements.ts'

test('whats-new pages start with the rename, then each shipped feature', () => {
  assert.deepEqual(
    WHATS_NEW_PAGES.map((page) => page.id),
    [
      'rename',
      'smart-projects',
      'family-tags',
      'document-font-sheet',
      'advanced-search',
      'activate-until-quit',
      'adobe-document-watch',
      'finder-extension',
      'compare',
    ],
  )
  assert.equal(WHATS_NEW_PAGES.length, 9)
  assert.equal(WHATS_NEW_PAGES[0]?.title, 'Now called Cuttler')
  assert.equal(WHATS_NEW_PAGES[2]?.title, 'Family tags')
  assert.match(WHATS_NEW_PAGES[2]?.body ?? '', /color/i)
  assert.equal(WHATS_NEW_PAGES[3]?.title, 'Document → Project')
  assert.equal(WHATS_NEW_PAGES[4]?.title, 'Advanced search')
  assert.match(WHATS_NEW_PAGES[4]?.body ?? '', /tag name/i)
  assert.match(WHATS_NEW_PAGES[4]?.body ?? '', /matching filters/i)
  assert.equal(WHATS_NEW_PAGES[5]?.title, 'Temporary install')
  assert.match(WHATS_NEW_PAGES[5]?.body ?? '', /Activate until quit/)
  assert.match(WHATS_NEW_PAGES[5]?.body ?? '', /temporary install/i)
  assert.equal(WHATS_NEW_PAGES[6]?.title, 'Adobe document watch')
  assert.match(WHATS_NEW_PAGES[6]?.body ?? '', /Watch documents in Adobe and Office/)
  assert.equal(WHATS_NEW_PAGES[7]?.title, 'Finder extension')
  assert.match(WHATS_NEW_PAGES[7]?.body ?? '', /Finder/i)
  assert.equal(WHATS_NEW_PAGES[8]?.title, 'Compare')
  assert.match(WHATS_NEW_PAGES[8]?.body ?? '', /Compare/)
  assert.equal(
    WHATS_NEW_PAGES.some((page) => page.id === 'library-search' || page.id === 'search-filter-suggestions'),
    false,
  )
  assert.equal(
    WHATS_NEW_PAGES.some((page) => page.id === 'new-tag-color'),
    false,
  )
  assert.equal(ANNOUNCEMENTS.length, 1)
  assert.equal(ANNOUNCEMENTS[0]?.id, 'whats-new')
  assert.equal(ANNOUNCEMENTS[0]?.celebrate, true)
  assert.equal(ANNOUNCEMENTS[0]?.showWhen, 'upgrade')
  assert.equal(ANNOUNCEMENTS[0]?.pages, WHATS_NEW_PAGES)
  assert.equal(
    WHATS_NEW_PAGES.some((page) => /conflict/i.test(`${page.id} ${page.title} ${page.body}`)),
    false,
  )
})

test('AnnouncementDialog reuses welcome Dialog surface classes', async () => {
  const source = await readFile(fileURLToPath(new URL('./AnnouncementDialog.tsx', import.meta.url)), 'utf8')
  assert.match(source, /from '@\/components\/ui\/dialog'/)
  assert.match(source, /w-\[min\(92vw,480px\)\]/)
  assert.match(source, /overflow-y-auto/)
  assert.match(source, /Got it/)
  assert.match(source, /Step /)
  assert.match(source, /page\?\.id === RENAME_PAGE_ID/)
  assert.match(
    source,
    /Cuttler has a new app icon\. You can keep your current one, or switch to the new mark\./,
  )
  assert.match(source, /Keep current icon/)
  assert.match(source, /Use new icon/)
  assert.match(source, /appIconPreviewSrc/)
  assert.match(source, /\/announcement\/smart-projects\.png/)
  assert.match(source, /\/announcement\/family-tags\.png/)
  assert.match(source, /\/announcement\/new-tag-color\.png/)
  assert.match(source, /\/announcement\/document-font-sheet\.png/)
  assert.match(source, /\/announcement\/library-search-typing\.png/)
  assert.match(source, /\/announcement\/library-search-tag\.png/)
  assert.match(source, /\/announcement\/search-filter-suggestions\.png/)
  assert.match(source, /\/announcement\/activate-until-quit-menu\.png/)
  assert.match(source, /\/announcement\/adobe-document-watch\.png/)
  assert.match(source, /\/announcement\/finder-extension-settings\.png/)
  assert.match(source, /\/announcement\/compare-window\.png/)
  assert.match(source, /'advanced-search':/)
  assert.match(source, /'activate-until-quit':/)
  assert.match(source, /'adobe-document-watch':/)
  assert.match(source, /'finder-extension':/)
  assert.match(source, /FINDER_EXTENSION_PAGE_ID/)
  assert.match(source, /Open Settings/)
  assert.match(source, /onOpenFinderSettings\?\.\(\)/)
  assert.match(source, /compare:\s*\[/)
  assert.doesNotMatch(source, /'library-search':/)
  assert.doesNotMatch(source, /'search-filter-suggestions':/)
  assert.doesNotMatch(source, /'new-tag-color':/)
  // Both icon-choice tiles use white card fills (never primary/black).
  assert.equal([...source.matchAll(/border bg-white px-3/g)].length, 2)
  assert.doesNotMatch(source, /offersIconChoice[\s\S]*?bg-primary/)
  assert.doesNotMatch(source, /backdrop-filter|vibrancy|dark-glass/)
  assert.doesNotMatch(source, /conflict/i)
})

test('whats-new announcement cutouts exist under public/announcement', async () => {
  const root = fileURLToPath(new URL('../../public/announcement', import.meta.url))
  const { access } = await import('node:fs/promises')
  for (const name of [
    'smart-projects.png',
    'family-tags.png',
    'document-font-sheet.png',
    'library-search-typing.png',
    'library-search-tag.png',
    'search-filter-suggestions.png',
    'new-tag-color.png',
    'activate-until-quit-menu.png',
    'adobe-document-watch.png',
    'finder-extension-settings.png',
    'compare-window.png',
  ]) {
    await access(`${root}/${name}`)
  }
})

test('library-search cutouts are tight action crops, not wide window slices', async () => {
  const { readFile } = await import('node:fs/promises')
  const root = fileURLToPath(new URL('../../public/announcement', import.meta.url))
  for (const name of [
    'library-search-typing.png',
    'library-search-tag.png',
    'activate-until-quit-menu.png',
    'adobe-document-watch.png',
    'finder-extension-settings.png',
    'compare-window.png',
  ]) {
    const buf = await readFile(`${root}/${name}`)
    assert.equal(buf.toString('ascii', 1, 4), 'PNG')
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    assert.ok(width < 1200, `${name} width ${width} still looks like a window slice`)
    assert.ok(height < 900, `${name} height ${height} still looks like a window slice`)
  }
})

test('ConfettiBurst is a main-window overlay, not nested in the dialog', async () => {
  const dialog = await readFile(fileURLToPath(new URL('./AnnouncementDialog.tsx', import.meta.url)), 'utf8')
  const confetti = await readFile(fileURLToPath(new URL('./ConfettiBurst.tsx', import.meta.url)), 'utf8')
  const app = await readFile(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')
  const settings = await readFile(fileURLToPath(new URL('./SettingsDialog.tsx', import.meta.url)), 'utf8')
  assert.doesNotMatch(dialog, /ConfettiBurst|confetti|canvas/)
  assert.match(confetti, /fixed inset-0/)
  assert.match(confetti, /burstConfetti/)
  assert.match(app, /<ConfettiBurst playKey=\{confettiPlayKey\}/)
  assert.match(app, /<AnnouncementDialog/)
  assert.match(app, /onSelectIcon=\{chooseAnnouncementIcon\}/)
  assert.match(app, /onOpenFinderSettings=\{openFinderSyncSettings\}/)
  assert.match(app, /highlightFinderSync=\{settingsFocusFinderSync\}/)
  assert.match(settings, /id="finder-sync-settings"/)
  assert.match(settings, /aria-label="Finder menu in Login Items"/)
  assert.match(app, /updateSettings\(\{ appIcon: style \}\)/)
})
