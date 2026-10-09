import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent } from './events.ts'
import { peekFontAnalysis, rememberFontAnalysis } from './font-analysis.ts'
import {
  INBOX_CORRUPT_ATTEMPT_LIMIT,
  INBOX_WRITE_STABILITY_MS,
  closeAllWatchers,
  expandImportPaths,
  inboxChangeShouldImport,
  inboxInFlightForTest,
  inboxRejectionForTest,
  inferExpandedFolderDrops,
  inspectDropPaths,
  listFontFilesInTree,
  queueInboxPathForTest,
  recordInboxImportResult,
  runInboxImportBatch,
  syncInboxWatcher,
} from './watch.ts'

function makeTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-walk-'))
  fs.writeFileSync(path.join(root, 'readme.txt'), 'nope')
  fs.writeFileSync(path.join(root, '.hidden.ttf'), 'skip')
  fs.writeFileSync(path.join(root, 'Top.ttf'), 'font')
  const nested = path.join(root, 'Family', 'Desktop', 'OTF')
  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'Regular.otf'), 'font')
  fs.writeFileSync(path.join(nested, 'Bold.otf'), 'font')
  const macosx = path.join(root, 'Family', '__MACOSX')
  fs.mkdirSync(macosx)
  fs.writeFileSync(path.join(macosx, 'junk.ttf'), 'skip')
  const web = path.join(root, 'Family', 'Web')
  fs.mkdirSync(web)
  fs.writeFileSync(path.join(web, 'Family.woff2'), 'font')
  return root
}

test('listFontFilesInTree walks nested folders and skips junk', () => {
  const root = makeTree()
  try {
    const files = listFontFilesInTree(root)
      .map((filePath) => path.relative(root, filePath))
      .sort()
    assert.deepEqual(files, [
      path.join('Family', 'Desktop', 'OTF', 'Bold.otf'),
      path.join('Family', 'Desktop', 'OTF', 'Regular.otf'),
      'Top.ttf',
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expandImportPaths collects fonts from folders and files', () => {
  const root = makeTree()
  try {
    const top = path.join(root, 'Top.ttf')
    const result = expandImportPaths([root, top, path.join(root, 'missing.ttf')])
    assert.equal(result.files.length, 4)
    assert.equal(result.skippedWeb, 1)
    assert.equal(result.files.filter((filePath) => filePath === path.resolve(top)).length, 1)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /Not found/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expandImportPaths reports folders with no fonts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-empty-'))
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'no fonts')
    const result = expandImportPaths([root])
    assert.deepEqual(result.files, [])
    assert.equal(result.skippedWeb, 0)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /No font files in that folder/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('expandImportPaths includes woff files for preview-only import', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-woff-'))
  try {
    const webOnlyDir = path.join(root, 'web')
    fs.mkdirSync(webOnlyDir)
    fs.writeFileSync(path.join(webOnlyDir, 'Family.woff2'), 'font')
    fs.writeFileSync(path.join(webOnlyDir, 'Family.woff'), 'font')
    const mixed = path.join(root, 'mixed')
    fs.mkdirSync(mixed)
    fs.writeFileSync(path.join(mixed, 'Regular.otf'), 'font')
    fs.writeFileSync(path.join(mixed, 'Web.woff2'), 'font')
    const webOnly = expandImportPaths([webOnlyDir])
    assert.equal(webOnly.files.length, 2)
    assert.equal(webOnly.skippedWeb, 2)
    assert.deepEqual(webOnly.errors, [])
    const mixedResult = expandImportPaths([mixed])
    assert.equal(mixedResult.files.length, 2)
    assert.equal(mixedResult.skippedWeb, 1)
    assert.deepEqual(mixedResult.errors, [])
    const fileResult = expandImportPaths([path.join(webOnlyDir, 'Family.woff2')])
    assert.equal(fileResult.files.length, 1)
    assert.equal(fileResult.skippedWeb, 1)
    assert.deepEqual(fileResult.errors, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inspectDropPaths reports a dropped directory', () => {
  const root = makeTree()
  try {
    const result = inspectDropPaths([root])
    assert.deepEqual(result.folders, [path.resolve(root)])
    assert.equal(result.files.length, 4)
    assert.deepEqual(
      result.formats.map((item) => item.format),
      ['otf', 'ttf'],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inferExpandedFolderDrops recovers a folder Electron expanded into files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-infer-'))
  try {
    const nested = path.join(root, 'Inbox', 'OTF')
    fs.mkdirSync(nested, { recursive: true })
    const otf = path.join(nested, 'Regular.otf')
    const ttfDir = path.join(root, 'Inbox', 'TTF')
    fs.mkdirSync(ttfDir)
    const ttf = path.join(ttfDir, 'Regular.ttf')
    fs.writeFileSync(otf, 'font')
    fs.writeFileSync(ttf, 'font')
    const inbox = path.join(root, 'Inbox')
    assert.deepEqual(inferExpandedFolderDrops([otf, ttf]), [inbox])
    const inspected = inspectDropPaths([otf, ttf])
    assert.deepEqual(inspected.folders, [inbox])
    assert.equal(inspected.files.length, 2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inferExpandedFolderDrops ignores extra woff files from a folder drop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-woff-infer-'))
  try {
    const inbox = path.join(root, 'Inbox')
    const otfDir = path.join(inbox, 'OTF')
    const webDir = path.join(inbox, 'Web')
    fs.mkdirSync(otfDir, { recursive: true })
    fs.mkdirSync(webDir)
    const otf = path.join(otfDir, 'Regular.otf')
    const ttf = path.join(inbox, 'Regular.ttf')
    const woff = path.join(webDir, 'Regular.woff2')
    fs.writeFileSync(otf, 'font')
    fs.writeFileSync(ttf, 'font')
    fs.writeFileSync(woff, 'font')
    assert.deepEqual(inferExpandedFolderDrops([otf, ttf, woff]), [inbox])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a rejected watch file is not a settled seen entry', () => {
  const failed = { size: 32, mtimeMs: 10 }
  assert.equal(inboxChangeShouldImport(undefined, undefined, undefined, false), false)
  assert.equal(inboxChangeShouldImport(undefined, undefined, undefined, true), true)
  assert.equal(inboxChangeShouldImport(failed, undefined, undefined, false), true)
  assert.equal(inboxChangeShouldImport(failed, 'same', 'same', false), true)
  assert.equal(inboxChangeShouldImport(undefined, 'next', 'previous', false), true)
  assert.equal(inboxChangeShouldImport(undefined, 'same', 'same', false), false)
})

test('recording a missing watch file does not store a negative stamp', () => {
  const missing = path.join(os.tmpdir(), `font-butler-gone-${process.pid}-${Date.now()}.ttf`)
  recordInboxImportResult([missing], [missing])
  assert.equal(inboxRejectionForTest(missing), undefined)
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await delay(20)
  }
  assert.fail(label)
}

test('a resync during a flush still imports paths queued for the new session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-resync-'))
  const first = path.join(root, 'A.ttf')
  const second = path.join(root, 'B.ttf')
  fs.writeFileSync(first, Buffer.from('aaaa'))
  fs.writeFileSync(second, Buffer.from('bbbb'))
  let releaseFirst!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const firstBatches: string[][] = []
  const secondBatches: string[][] = []
  try {
    await syncInboxWatcher([root], async (files) => {
      firstBatches.push(files.map((file) => path.resolve(file)))
      await gate
      return { failedPaths: files }
    })
    queueInboxPathForTest(first)
    await waitFor(() => firstBatches.length > 0, 3000, 'first flush did not start')
    await syncInboxWatcher([root], async (files) => {
      secondBatches.push(files.map((file) => path.resolve(file)))
      return { failedPaths: files }
    })
    queueInboxPathForTest(second)
    assert.equal(secondBatches.length, 0)
    releaseFirst()
    await waitFor(
      () => secondBatches.some((batch) => batch.includes(path.resolve(second))),
      3000,
      'resync during flush stranded the new session',
    )
    const rejection = inboxRejectionForTest(first)
    assert.ok(rejection)
    assert.ok(rejection.size >= 0)
  } finally {
    releaseFirst()
    await closeAllWatchers()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a path stays in flight until the startup import finishes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-inflight-'))
  const font = path.join(root, 'Startup.ttf')
  fs.writeFileSync(font, Buffer.from('partial-font!!'))
  const seen: string[][] = []
  try {
    await syncInboxWatcher([root], async (files) => {
      seen.push(files.map((file) => path.resolve(file)))
      return { failedPaths: files }
    })
    let during = false
    await runInboxImportBatch([font], async () => {
      during = inboxInFlightForTest(font)
      fs.writeFileSync(font, Buffer.from('partial-font??'))
      await delay(INBOX_WRITE_STABILITY_MS + 800)
      return { failedPaths: [font] }
    })
    assert.equal(during, true)
    await waitFor(
      () => seen.some((batch) => batch.includes(path.resolve(font))),
      3000,
      'change during startup import was dropped',
    )
    assert.equal(inboxInFlightForTest(font), false)
  } finally {
    await closeAllWatchers()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('an in-flight change drops cached analysis before the follow-up import', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-forget-'))
  const font = path.join(root, 'Cached.ttf')
  fs.writeFileSync(font, Buffer.alloc(32, 1))
  const stat = fs.statSync(font)
  rememberFontAnalysis({
    path: path.resolve(font),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    fingerprint: 'stale',
    parsed: { faces: [], format: 'ttf', previewSample: 'Aa' },
  })
  assert.ok(peekFontAnalysis(font))
  try {
    await syncInboxWatcher([root], async () => ({ failedPaths: [] }))
    await runInboxImportBatch([font], async () => {
      const before = fs.statSync(font)
      fs.writeFileSync(font, Buffer.alloc(before.size, 2))
      fs.utimesSync(font, before.atime, before.mtime)
      await delay(INBOX_WRITE_STABILITY_MS + 800)
      assert.equal(peekFontAnalysis(font), undefined)
      return { failedPaths: [font] }
    })
  } finally {
    await closeAllWatchers()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('closeAllWatchers does not record a flush that finishes afterwards', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-closed-'))
  const font = path.join(root, 'Late.ttf')
  fs.writeFileSync(font, Buffer.from('late'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await syncInboxWatcher([root], async (files) => {
      await gate
      return {
        failedPaths: files,
        failures: [{ path: files[0] ?? font, message: 'bad' }],
      }
    })
    queueInboxPathForTest(font)
    await waitFor(() => inboxInFlightForTest(font), 3000, 'flush did not start')
    const closed = closeAllWatchers()
    release()
    await closed
    await delay(50)
    assert.equal(inboxRejectionForTest(font), undefined)
  } finally {
    release()
    await closeAllWatchers()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a corrupt watch file is reported once after repeated failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-attempts-'))
  const font = path.join(root, 'Bad.ttf')
  fs.writeFileSync(font, Buffer.from('not-a-font'))
  const notices: string[] = []
  const stop = onEvent((event) => {
    if (event.type === 'notice' && event.notice.kind === 'error') notices.push(event.notice.message)
  })
  try {
    const failure = { path: font, message: 'Not a font file.' }
    for (let attempt = 1; attempt < INBOX_CORRUPT_ATTEMPT_LIMIT; attempt += 1) {
      recordInboxImportResult([font], [font], { failures: [failure] })
      assert.equal(notices.length, 0)
    }
    recordInboxImportResult([font], [font], { failures: [failure] })
    assert.equal(notices.length, 1)
    assert.match(notices[0] ?? '', /Not a font file/)
    recordInboxImportResult([font], [font], { failures: [failure] })
    assert.equal(notices.length, 1)
    assert.equal(inboxRejectionForTest(font)?.reported, true)
  } finally {
    stop()
    await closeAllWatchers()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('inferExpandedFolderDrops ignores a partial file selection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-partial-'))
  try {
    const regular = path.join(root, 'Regular.otf')
    const bold = path.join(root, 'Bold.otf')
    fs.writeFileSync(regular, 'font')
    fs.writeFileSync(bold, 'font')
    assert.deepEqual(inferExpandedFolderDrops([regular]), [])
    assert.deepEqual(inferExpandedFolderDrops([regular, bold]), [root])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
