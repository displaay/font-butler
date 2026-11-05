import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { reportDocumentFonts } from '../core/document-fonts.ts'
import { loadSettings } from '../core/settings.ts'
import { withService } from '../core/test-util.ts'
import {
  INDESIGN_FONT_POLL_MS,
  createDocumentAppObserver,
  recentDocumentPaths,
  recentFileMatchesBundle,
} from './document-app-watch.mjs'
import { fontsFromInDesignReply } from './indesign-fonts.mjs'
import {
  classifyOpenedDocument,
  createDocumentOpenWatch,
  documentPathsFromBytes,
  documentPathsFromLsof,
  documentWatchIpc,
  parseFrontAppInfo,
  pickOpenedDocumentPath,
  unsupportedDocumentNote,
} from './document-open-watch.mjs'

const INDESIGN = 'com.adobe.InDesign'
const WORD = 'com.microsoft.Word'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-watch-'))
}

function inddWithFonts() {
  return Buffer.from(
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:xmpTPg="http://ns.adobe.com/xap/1.0/t/pg/" xmlns:stFnt="http://ns.adobe.com/xap/1.0/sType/Font#">
      <xmpTPg:Fonts>
        <rdf:Bag>
          <rdf:li stFnt:fontName="Family-Regular" stFnt:fontFamily="Family" stFnt:fontFace="Regular"/>
        </rdf:Bag>
      </xmpTPg:Fonts>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`,
    'utf8',
  )
}

function writePdf(dir, name = 'Note.pdf') {
  const filePath = path.join(dir, name)
  fs.writeFileSync(
    filePath,
    '%PDF-1.4\n1 0 obj\n<< /BaseFont /Family-Regular >>\nendobj\n%%EOF\n',
  )
  return filePath
}

function catalog() {
  return [
    {
      id: 'regular',
      sourcePath: '/library/Family-Regular.otf',
      sourceMtimeMs: 1,
      sourceSize: 1,
      status: 'deactivated',
      installedFingerprint: 'fp-regular',
      faces: [
        {
          familyName: 'Family',
          styleName: 'Regular',
          fullName: 'Family Regular',
          postscriptName: 'Family-Regular',
          isVariable: false,
          instanceCount: 0,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
      format: 'otf',
      addedAt: 1,
      updatedAt: 1,
    },
  ]
}

test('a fake opened path parses pdf, indd, and ai, and only notes figma', () => {
  const dir = tempDir()
  try {
    const pdf = writePdf(dir)
    const indd = path.join(dir, 'Book.indd')
    fs.writeFileSync(indd, inddWithFonts())
    const ai = path.join(dir, 'Mark.ai')
    fs.writeFileSync(ai, inddWithFonts())
    const parsed = []
    const effects = []
    const watch = createDocumentOpenWatch({
      enabled: true,
      debounceMs: 0,
      parse(filePath) {
        parsed.push(filePath)
        return reportDocumentFonts(filePath, catalog())
      },
      onEffect(effect) {
        effects.push(effect)
      },
    })

    watch.open({ bundleId: INDESIGN, path: pdf })
    watch.open({ bundleId: INDESIGN, path: indd })
    watch.open({ bundleId: 'com.adobe.illustrator', path: ai })
    watch.open({ bundleId: 'com.figma.Desktop', path: path.join(dir, 'Board.fig') })

    assert.deepEqual(parsed, [pdf, indd, ai])
    assert.equal(effects.length, 4)
    assert.equal(effects[0].action, 'sheet')
    assert.equal(effects[0].report.kind, 'pdf')
    assert.equal(effects[0].report.fonts[0].postscriptName, 'Family-Regular')
    assert.equal(effects[0].report.fonts[0].status, 'in-library-off')
    assert.equal(effects[0].report.fonts[0].assetId, 'regular')
    assert.equal(effects[0].activate, undefined)
    assert.deepEqual(documentWatchIpc(effects[0]), {
      channel: 'open-document',
      payload: { path: pdf },
    })
    assert.equal(effects[1].action, 'sheet')
    assert.equal(effects[1].report.kind, 'indd')
    assert.equal(effects[1].report.fonts[0].postscriptName, 'Family-Regular')
    assert.equal(effects[1].report.fonts[0].familyName, 'Family')
    assert.equal(effects[2].action, 'sheet')
    assert.equal(effects[2].report.kind, 'ai')
    assert.equal(effects[3].action, 'note')
    assert.equal(effects[3].message.includes('\n'), false)
    assert.equal(documentWatchIpc(effects[3]).channel, 'document-watch-note')
    assert.equal(unsupportedDocumentNote(indd), '')
    assert.match(unsupportedDocumentNote(path.join(dir, 'Board.fig')), /Export a PDF/i)

    watch.open({ bundleId: INDESIGN, path: pdf })
    assert.deepEqual(parsed, [pdf, indd, ai])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the watch stays off until enabled and ignores other apps', () => {
  const dir = tempDir()
  try {
    const pdf = writePdf(dir)
    const parsed = []
    const watch = createDocumentOpenWatch({
      enabled: false,
      debounceMs: 0,
      parse(filePath) {
        parsed.push(filePath)
        return reportDocumentFonts(filePath, [])
      },
    })
    watch.open({ bundleId: WORD, path: pdf })
    watch.open({ bundleId: 'com.apple.Preview', path: pdf })
    assert.deepEqual(parsed, [])
    watch.setEnabled(true)
    watch.open({ bundleId: 'com.apple.Preview', path: pdf })
    assert.deepEqual(parsed, [])
    watch.open({ bundleId: `${WORD}.standalone`, path: `file://${pdf}` })
    assert.deepEqual(parsed, [pdf])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('debounce keeps one sheet, and a second path replaces a pending one', () => {
  const dir = tempDir()
  try {
    const first = writePdf(dir, 'First.pdf')
    const second = writePdf(dir, 'Second.pdf')
    const parsed = []
    let pending = null
    let scheduled = 0
    const watch = createDocumentOpenWatch({
      enabled: true,
      debounceMs: 400,
      parse(filePath) {
        parsed.push(filePath)
        return { path: filePath }
      },
      schedule(fn) {
        scheduled += 1
        pending = fn
        return () => {
          pending = null
        }
      },
    })
    watch.open({ bundleId: INDESIGN, path: first })
    watch.open({ bundleId: INDESIGN, path: first })
    assert.equal(scheduled, 1)
    watch.open({ bundleId: INDESIGN, path: second })
    assert.equal(scheduled, 2)
    assert.deepEqual(parsed, [])
    assert.equal(typeof pending, 'function')
    pending()
    assert.deepEqual(parsed, [second])
    watch.open({ bundleId: INDESIGN, path: second })
    assert.equal(scheduled, 2)
    assert.deepEqual(parsed, [second])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('supported Office and IDML paths are parsed and other extensions are ignored', () => {
  const seen = []
  const watch = createDocumentOpenWatch({
    enabled: true,
    debounceMs: 0,
    parse(filePath) {
      seen.push(path.extname(filePath))
      return { path: filePath }
    },
  })
  for (const name of [
    'Notes.docx',
    'Deck.pptx',
    'Story.idml',
    'Book.indd',
    'Book.indt',
    'Mark.ai',
    'Photo.psd',
    'Photo.psb',
    'Notes.txt',
    'Board.fig',
  ]) {
    watch.open({ bundleId: WORD, path: path.join('/docs', name) })
  }
  assert.deepEqual(seen, ['.docx', '.pptx', '.idml', '.indd', '.indt', '.ai', '.psd', '.psb'])
  assert.equal(classifyOpenedDocument('/docs/Notes.txt'), 'ignore')
  assert.equal(classifyOpenedDocument('/docs/Book.INDD'), 'parse')
  assert.equal(classifyOpenedDocument('/docs/Board.fig'), 'note')
})

test('an unsupported front document does not parse, and a quiet watch does not note it', () => {
  const dir = tempDir()
  try {
    const fig = path.join(dir, 'Board.fig')
    fs.writeFileSync(fig, 'binary')
    const parsed = []
    const notes = []
    const watch = createDocumentOpenWatch({
      enabled: false,
      debounceMs: 0,
      parse(filePath) {
        parsed.push(filePath)
        return reportDocumentFonts(filePath, [])
      },
      onEffect(effect) {
        if (effect.action === 'note') notes.push(effect.message)
      },
    })
    watch.open({ bundleId: 'com.figma.Desktop', path: fig })
    assert.deepEqual(parsed, [])
    assert.deepEqual(notes, [])
    watch.setEnabled(true)
    watch.open({ bundleId: 'com.figma.Desktop', path: fig })
    assert.deepEqual(parsed, [])
    assert.deepEqual(notes, ['This Figma file is not read here. Export a PDF to see its fonts.'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('front app text, lsof, and recent bytes yield one opened path', async () => {
  const info = parseFrontAppInfo(`"CFBundleIdentifier"="com.adobe.InDesign.2025" ASN:0x0-0x1:\n"pid"=42\n`)
  assert.deepEqual(info, { bundleId: 'com.adobe.InDesign.2025', pid: 42 })
  const openPaths = documentPathsFromLsof(
    ['p42', 'fcwd', 'n/Users/me', 'ftxt', 'n/Users/me/Old.pdf', 'f8', 'n/Users/me/New.docx'].join('\n'),
  )
  assert.deepEqual(openPaths, ['/Users/me/Old.pdf', '/Users/me/New.docx'])
  const recent = documentPathsFromBytes(
    Buffer.from('junk\0file:///Users/me/My%20Doc.pdf\0/Users/me/Book.indd\0', 'utf8'),
  )
  assert.deepEqual(recent, ['/Users/me/My Doc.pdf', '/Users/me/Book.indd'])

  const opened = []
  let recentPaths = ['/Users/me/My Doc.pdf']
  let openNow = ['/Users/me/Old.pdf']
  const observer = createDocumentAppObserver({
    platform: 'darwin',
    pollMs: 60_000,
    openFilePollMs: 0,
    now: () => 1_000,
    readFront: async () => ({ bundleId: 'com.adobe.InDesign.2025', pid: 42 }),
    listOpenPaths: async () => openNow,
    listRecentPaths: async () => recentPaths,
    onOpenedPath(event) {
      opened.push(event)
    },
  })

  observer.start()
  await observer.whenIdle()
  assert.deepEqual(opened, [{ bundleId: 'com.adobe.InDesign.2025', path: '/Users/me/My Doc.pdf' }])
  openNow = ['/Users/me/Old.pdf', '/Users/me/New.docx']
  await observer.poll()
  assert.deepEqual(opened, [
    { bundleId: 'com.adobe.InDesign.2025', path: '/Users/me/My Doc.pdf' },
    { bundleId: 'com.adobe.InDesign.2025', path: '/Users/me/New.docx' },
  ])
  observer.stop()

  const inddDir = tempDir()
  const inddPath = path.join(inddDir, 'Book.indd')
  fs.writeFileSync(inddPath, 'x')
  const parsed = []
  const inddWatch = createDocumentOpenWatch({
    enabled: true,
    debounceMs: 0,
    parse(filePath) {
      parsed.push(filePath)
      return { path: filePath }
    },
  })
  const inddObserver = createDocumentAppObserver({
    platform: 'darwin',
    pollMs: 60_000,
    openFilePollMs: 0,
    readFront: async () => ({ bundleId: INDESIGN, pid: 7 }),
    listOpenPaths: async () => [inddPath],
    listRecentPaths: async () => [inddPath],
    onOpenedPath(event) {
      inddWatch.open(event)
    },
  })
  try {
    inddObserver.start()
    await inddObserver.whenIdle()
    assert.deepEqual(parsed, [inddPath])
  } finally {
    inddObserver.stop()
    fs.rmSync(inddDir, { recursive: true, force: true })
  }
  assert.equal(
    pickOpenedDocumentPath({
      activation: false,
      hasBaseline: true,
      openPaths: ['/a.pdf'],
      previousOpenPaths: ['/a.pdf'],
    }),
    null,
  )
  assert.equal(
    pickOpenedDocumentPath({
      activation: false,
      hasBaseline: true,
      openPaths: ['/a.pdf', '/b.indd'],
      previousOpenPaths: ['/a.pdf'],
    }),
    '/b.indd',
  )
})

test('versioned Adobe bundle ids still find the shared recent-document file', () => {
  assert.equal(recentFileMatchesBundle('com.adobe.InDesign.2025', 'com.adobe.InDesign.sfl3'), true)
  assert.equal(recentFileMatchesBundle('com.adobe.InDesign.2025', 'com.adobe.InDesign.2025.sfl3'), true)
  assert.equal(recentFileMatchesBundle('com.adobe.InDesign', 'com.adobe.Photoshop.sfl3'), false)
  const home = '/Users/me'
  const shared = `${home}/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments`
  const paths = recentDocumentPaths('com.adobe.InDesign.2025', {
    home,
    readDir(dir) {
      if (dir !== shared) return []
      return ['com.adobe.Photoshop.sfl3', 'com.adobe.InDesign.sfl3']
    },
    readFile(filePath) {
      assert.match(filePath, /InDesign\.sfl3$/)
      return Buffer.from('file:///Users/me/Brochure.pdf', 'utf8')
    },
    statMtime() {
      return 10
    },
  })
  assert.deepEqual(paths, ['/Users/me/Brochure.pdf'])
})

test('the macOS observer does not use Accessibility or activate other apps', () => {
  const source = fs.readFileSync(new URL('./document-app-watch.mjs', import.meta.url), 'utf8')
  assert.equal(/System Events|AXUIElement|osascript|tell application|NSAppleScript/.test(source), false)
  const ask = fs.readFileSync(new URL('./indesign-fonts.mm', import.meta.url), 'utf8')
  assert.equal(/osascript|NSAppleScript|tell application/.test(ask), false)
  assert.match(ask, /descriptorWithProcessIdentifier/)
  assert.match(ask, /PropertyOf\("fPSN"/)
  assert.match(ask, /PropertyOf\("fFam"/)
  assert.match(ask, /PropertyOf\("fSty"/)
  assert.match(ask, /Every\("docu"/)
  assert.match(ask, /Every\("FonT"/)
  assert.equal(INDESIGN_FONT_POLL_MS, 500)
})

test('InDesign live reply lines up names and drops a row with no name', () => {
  const lined = fontsFromInDesignReply({
    postscriptNames: ['Family-Regular', '  ', 'Family-Bold'],
    families: ['Family', '', 'Family'],
    styles: ['', 'Regular', 'Bold'],
  })
  assert.equal(lined.refused, false)
  assert.deepEqual(lined.fonts, [
    { postscriptName: 'Family-Regular', familyName: 'Family', styleName: '' },
    { postscriptName: 'Family-Bold', familyName: 'Family', styleName: 'Bold' },
  ])
  const uneven = fontsFromInDesignReply({
    postscriptNames: ['Family-Regular'],
    families: ['Family', 'Family'],
    styles: ['Regular'],
  })
  assert.deepEqual(uneven.fonts, [])
  assert.equal(fontsFromInDesignReply({ refused: true }).refused, true)
  assert.equal(fontsFromInDesignReply({ unavailable: true }).unavailable, true)
})

test('frontmost InDesign is asked for fonts and the open file is not read', async () => {
  const asked = []
  const opened = []
  const live = []
  let openCalls = 0
  const delays = []
  let tick = () => {}
  let reply = {
    postscriptNames: ['Family-Regular', 'Family-Bold'],
    families: ['Family', 'Family'],
    styles: ['', 'Bold'],
  }
  let front = { bundleId: INDESIGN, pid: 42 }
  const observer = createDocumentAppObserver({
    platform: 'darwin',
    pollMs: 60_000,
    openFilePollMs: 0,
    readFront: async () => front,
    askInDesign: async (pid) => {
      asked.push(pid)
      return reply
    },
    listOpenPaths: async () => {
      openCalls += 1
      return ['/tmp/Book.indd']
    },
    listRecentPaths: async () => ['/tmp/Book.indd'],
    onOpenedPath(event) {
      opened.push(event)
    },
    onInDesignFonts(event) {
      live.push(event)
    },
    scheduleInterval(fn, ms) {
      delays.push(ms)
      tick = fn
      return () => {
        tick = () => {}
      }
    },
  })
  try {
    observer.start()
    await observer.whenIdle()
    assert.deepEqual(asked, [42])
    assert.equal(openCalls, 0)
    assert.deepEqual(opened, [])
    assert.equal(live.length, 1)
    assert.equal(live[0].fonts[0].styleName, '')
    assert.equal(live[0].fonts[1].postscriptName, 'Family-Bold')
    assert.deepEqual(delays, [500])

    tick()
    await observer.whenIdle()
    assert.deepEqual(asked, [42, 42])
    assert.equal(live.length, 1)

    reply = {
      postscriptNames: ['Family-Bold'],
      families: ['Family'],
      styles: ['Bold'],
    }
    tick()
    await observer.whenIdle()
    assert.equal(live.length, 2)
    assert.equal(live[1].fonts.length, 1)

    front = { bundleId: 'com.adobe.illustrator', pid: 9 }
    await observer.poll()
    assert.equal(openCalls, 1)
    assert.equal(asked.length, 3)

    front = { bundleId: INDESIGN, pid: 42 }
    reply = {
      postscriptNames: ['Family-Bold'],
      families: ['Family'],
      styles: ['Bold'],
    }
    await observer.poll()
    assert.equal(live.length, 3)
    assert.equal(openCalls, 1)
  } finally {
    observer.stop()
  }
})

test('an empty InDesign reply does not read the open file', async () => {
  let openCalls = 0
  let live = 0
  const observer = createDocumentAppObserver({
    platform: 'darwin',
    pollMs: 60_000,
    readFront: async () => ({ bundleId: INDESIGN, pid: 7 }),
    askInDesign: async () => ({ postscriptNames: [], families: [], styles: [] }),
    listOpenPaths: async () => {
      openCalls += 1
      return ['/tmp/Book.indd']
    },
    onOpenedPath() {
      throw new Error('opened a path')
    },
    onInDesignFonts() {
      live += 1
    },
    scheduleInterval() {
      return () => {}
    },
  })
  try {
    observer.start()
    await observer.whenIdle()
    assert.equal(openCalls, 0)
    assert.equal(live, 0)
  } finally {
    observer.stop()
  }
})

test('a refused InDesign is asked once, and a missing ask reads the file', async () => {
  let calls = 0
  const refused = createDocumentAppObserver({
    platform: 'darwin',
    pollMs: 60_000,
    readFront: async () => ({ bundleId: INDESIGN, pid: 5 }),
    askInDesign: async () => {
      calls += 1
      return { refused: true }
    },
    listOpenPaths: async () => {
      throw new Error('file path')
    },
    onOpenedPath() {
      throw new Error('opened a path')
    },
    onInDesignFonts() {
      throw new Error('fonts')
    },
  })
  try {
    refused.start()
    await refused.whenIdle()
    await refused.poll()
    assert.equal(calls, 1)
  } finally {
    refused.stop()
  }

  const opened = []
  const fallback = createDocumentAppObserver({
    platform: 'darwin',
    pollMs: 60_000,
    openFilePollMs: 0,
    readFront: async () => ({ bundleId: INDESIGN, pid: 5 }),
    askInDesign: async () => ({ unavailable: true }),
    listOpenPaths: async () => ['/tmp/Book.indd'],
    listRecentPaths: async () => [],
    onOpenedPath(event) {
      opened.push(event.path)
    },
  })
  try {
    fallback.start()
    await fallback.whenIdle()
    assert.deepEqual(opened, ['/tmp/Book.indd'])
  } finally {
    fallback.stop()
  }
})

test('a live InDesign list opens the sheet without reading a file', () => {
  const parsed = []
  const effects = []
  const watch = createDocumentOpenWatch({
    enabled: true,
    debounceMs: 0,
    parse(filePath) {
      parsed.push(filePath)
      return { path: filePath }
    },
    onEffect(effect) {
      effects.push(effect)
    },
  })
  const fonts = [{ postscriptName: 'Family-Regular', familyName: 'Family', styleName: 'Regular' }]
  watch.live({ bundleId: INDESIGN, fonts })
  watch.live({ bundleId: 'com.adobe.illustrator', fonts })
  assert.deepEqual(parsed, [])
  assert.equal(effects.length, 1)
  assert.equal(effects[0].action, 'live')
  assert.deepEqual(documentWatchIpc(effects[0]), {
    channel: 'open-document',
    payload: { liveFonts: fonts, name: 'InDesign' },
  })
  assert.equal(documentWatchIpc({ action: 'live', fonts: [] }), null)
})

test('the observer does not start away from macOS', async () => {
  let reads = 0
  const observer = createDocumentAppObserver({
    platform: 'linux',
    readFront: async () => {
      reads += 1
      return { bundleId: INDESIGN, pid: 1 }
    },
    onOpenedPath() {
      throw new Error('opened a path')
    },
  })
  observer.start()
  await observer.whenIdle()
  assert.equal(reads, 0)
  observer.stop()
})

test('watchDocumentOpens defaults off and does not activate fonts when saved', async () => {
  await withService(async (service) => {
    assert.equal(service.getSettings().watchDocumentOpens, false)
    const settings = await service.updateSettings({ watchDocumentOpens: true })
    assert.equal(settings.watchDocumentOpens, true)
    assert.equal(service.listCatalog().length, 0)
    const stored = loadSettings(service.paths)
    assert.equal(stored.watchDocumentOpens, true)
    const off = await service.updateSettings({ watchDocumentOpens: false })
    assert.equal(off.watchDocumentOpens, false)
  })
})
