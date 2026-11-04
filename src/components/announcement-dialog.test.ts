import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ANNOUNCEMENTS, WHATS_NEW_PAGES } from '../../shared/announcements.ts'

test('whats-new pages start with the rename, then each shipped feature', () => {
  assert.deepEqual(
    WHATS_NEW_PAGES.map((page) => page.id),
    ['rename', 'smart-projects', 'family-tags', 'document-font-sheet'],
  )
  assert.equal(WHATS_NEW_PAGES[0]?.title, 'Now called Cuttler')
  assert.equal(WHATS_NEW_PAGES[3]?.title, 'Document → Project')
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
  assert.match(source, /\/announcement\/document-font-sheet\.png/)
  // Both icon-choice tiles use white card fills (never primary/black).
  assert.equal([...source.matchAll(/border bg-white px-3/g)].length, 2)
  assert.doesNotMatch(source, /offersIconChoice[\s\S]*?bg-primary/)
  assert.doesNotMatch(source, /backdrop-filter|vibrancy|dark-glass/)
  assert.doesNotMatch(source, /conflict/i)
})

test('ConfettiBurst is a main-window overlay, not nested in the dialog', async () => {
  const dialog = await readFile(fileURLToPath(new URL('./AnnouncementDialog.tsx', import.meta.url)), 'utf8')
  const confetti = await readFile(fileURLToPath(new URL('./ConfettiBurst.tsx', import.meta.url)), 'utf8')
  const app = await readFile(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')
  assert.doesNotMatch(dialog, /ConfettiBurst|confetti|canvas/)
  assert.match(confetti, /fixed inset-0/)
  assert.match(confetti, /burstConfetti/)
  assert.match(app, /<ConfettiBurst playKey=\{confettiPlayKey\}/)
  assert.match(app, /<AnnouncementDialog/)
  assert.match(app, /onSelectIcon=\{chooseAnnouncementIcon\}/)
  assert.match(app, /updateSettings\(\{ appIcon: style \}\)/)
})
