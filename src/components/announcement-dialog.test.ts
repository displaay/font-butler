import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('AnnouncementDialog reuses welcome Dialog surface classes', async () => {
  const source = await readFile(fileURLToPath(new URL('./AnnouncementDialog.tsx', import.meta.url)), 'utf8')
  assert.match(source, /from '@\/components\/ui\/dialog'/)
  assert.match(source, /w-\[min\(92vw,480px\)\]/)
  assert.match(source, /Got it/)
  assert.match(source, /rename-to-cuttler/)
  assert.match(source, /This is a new icon\. Keep the old one, or use the new one\?/)
  assert.match(source, /Keep the old one/)
  assert.match(source, /Use the new one/)
  assert.match(source, /appIconPreviewSrc/)
  assert.doesNotMatch(source, /backdrop-filter|vibrancy|dark-glass/)
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
