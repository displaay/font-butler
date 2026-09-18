import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { compileFinderServicesAddon } from '../scripts/build-finder-services.mjs'
import {
  CLAIMED_FONT_EXTENSIONS,
  FINDER_INSTALL,
  FINDER_INSTALL_AS,
  FINDER_INSTALL_AS_FLAG,
  FINDER_INSTALL_AS_MESSAGE,
  FINDER_INSTALL_FLAG,
  FINDER_INSTALL_MESSAGE,
  FINDER_LINK_TO,
  FINDER_LINK_TO_FLAG,
  FINDER_LINK_TO_MESSAGE,
  FINDER_PROTOCOL,
  FINDER_SERVICE_PORT_NAME,
  FONT_SERVICE_UTIS,
  collectFinderFontPaths,
  destinationChoices,
  familyNamePromptScript,
  finderInstallUrl,
  finderServiceMenuTitle,
  finderServicesPlist,
  finderUrlSchemePlist,
  groupIdsByFormat,
  idsEligibleForFinderInstall,
  isInstallableFontPath,
  parseFinderInstallUrl,
  parseFinderLaunch,
  suggestedFamilyName,
} from './finder-install.mjs'

function readRepo(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('Finder services advertise Install, Install as…, and Link to … for font UTIs', () => {
  const services = finderServicesPlist()
  assert.equal(services.length, 3)
  assert.equal(finderServiceMenuTitle(FINDER_INSTALL), 'Install')
  assert.equal(finderServiceMenuTitle(FINDER_INSTALL_AS), 'Install as…')
  assert.equal(finderServiceMenuTitle(FINDER_LINK_TO), 'Link to …')
  assert.deepEqual(
    services.map((item) => item.NSMenuItem.default),
    ['Install', 'Install as…', 'Link to …'],
  )
  assert.deepEqual(
    services.map((item) => item.NSMessage),
    [FINDER_INSTALL_MESSAGE, FINDER_INSTALL_AS_MESSAGE, FINDER_LINK_TO_MESSAGE],
  )
  assert.ok(services.every((item) => item.NSPortName === FINDER_SERVICE_PORT_NAME))
  assert.deepEqual(services[0].NSSendFileTypes, FONT_SERVICE_UTIS)
  assert.ok(FONT_SERVICE_UTIS.includes('public.font'))
  assert.ok(FONT_SERVICE_UTIS.includes('public.opentype-font'))
  assert.ok(FONT_SERVICE_UTIS.includes('public.truetype-ttf-font'))
  assert.ok(FONT_SERVICE_UTIS.includes('public.truetype-collection-font'))
})

test('packaged Info.plist sources include Finder services and the font-butler URL scheme', () => {
  const pkg = JSON.parse(readRepo('package.json'))
  assert.deepEqual(pkg.build.mac.extendInfo.NSServices, finderServicesPlist())
  assert.deepEqual(pkg.build.mac.extendInfo.CFBundleURLTypes, finderUrlSchemePlist())
  assert.equal(pkg.build.asarUnpack.includes('**/*.node'), true)
  assert.match(pkg.scripts.dist, /build-finder-services/)
  assert.doesNotMatch(pkg.scripts.dist, /CSC_IDENTITY_AUTO_DISCOVERY=false/)
})

test('parseFinderLaunch reads install flags, URLs, and font paths', () => {
  assert.equal(parseFinderLaunch(['electron', '.']), null)
  assert.deepEqual(parseFinderLaunch(['electron', '.', FINDER_INSTALL_FLAG, '/Fonts/A.otf', '/Fonts/B.ttf']), {
    action: FINDER_INSTALL,
    paths: ['/Fonts/A.otf', '/Fonts/B.ttf'],
  })
  assert.deepEqual(
    parseFinderLaunch(['/App/Font Buttler', FINDER_INSTALL_AS_FLAG, '/Fonts/Display.ttc']),
    { action: FINDER_INSTALL_AS, paths: ['/Fonts/Display.ttc'] },
  )
  const url = finderInstallUrl(FINDER_INSTALL, ['/Fonts/A.otf', '/Fonts/B.otc'])
  assert.match(url, new RegExp(`^${FINDER_PROTOCOL}://finder/install`))
  assert.deepEqual(parseFinderInstallUrl(url), {
    action: FINDER_INSTALL,
    paths: ['/Fonts/A.otf', '/Fonts/B.otc'],
  })
  assert.deepEqual(parseFinderLaunch(['Font Buttler', url]), {
    action: FINDER_INSTALL,
    paths: ['/Fonts/A.otf', '/Fonts/B.otc'],
  })
  assert.deepEqual(
    parseFinderInstallUrl(
      `${FINDER_PROTOCOL}://finder/install-as?files=${encodeURIComponent('/a.ttf\n/b.otf')}`,
    ),
    { action: FINDER_INSTALL_AS, paths: ['/a.ttf', '/b.otf'] },
  )
  assert.deepEqual(parseFinderInstallUrl(`${FINDER_PROTOCOL}://finder/install?p=file:///Library/Fonts/A.otf`), {
    action: FINDER_INSTALL,
    paths: ['/Library/Fonts/A.otf'],
  })
  assert.equal(parseFinderInstallUrl('https://example.test/finder/install'), null)
  assert.deepEqual(
    parseFinderLaunch(['electron', '.', FINDER_LINK_TO_FLAG, '/Fonts/A.otf', '/Fonts/B.woff2']),
    { action: FINDER_LINK_TO, paths: ['/Fonts/A.otf', '/Fonts/B.woff2'] },
  )
  const linkUrl = finderInstallUrl(FINDER_LINK_TO, ['/Fonts/A.woff'])
  assert.match(linkUrl, new RegExp(`^${FINDER_PROTOCOL}://finder/link-to`))
  assert.deepEqual(parseFinderInstallUrl(linkUrl), {
    action: FINDER_LINK_TO,
    paths: ['/Fonts/A.woff'],
  })
})

test('collectFinderFontPaths keeps installable fonts and folders, skips WOFF', () => {
  assert.equal(isInstallableFontPath('/x.otf'), true)
  assert.equal(isInstallableFontPath('/x.woff2'), false)
  const collected = collectFinderFontPaths([
    '/Fonts/A.otf',
    '/Fonts/B.woff',
    '/Fonts/C.ttc',
    '/Fonts/A.otf',
    '/missing.ttf',
  ])
  assert.deepEqual(collected.paths, ['/Fonts/A.otf', '/Fonts/C.ttc', '/missing.ttf'])
  assert.deepEqual(collected.skippedWeb, ['/Fonts/B.woff'])

  const withFs = collectFinderFontPaths(['/Fonts/A.otf', '/Fonts/Folder', '/gone.ttf', '/web.woff2'], {
    existsSync: (filePath) => filePath !== '/gone.ttf',
    statSync: (filePath) => ({
      isDirectory: () => filePath === '/Fonts/Folder',
    }),
  })
  assert.deepEqual(withFs.paths, ['/Fonts/A.otf', '/Fonts/Folder'])
  assert.deepEqual(withFs.skippedWeb, ['/web.woff2'])
  assert.deepEqual(withFs.missing, ['/gone.ttf'])
})

test('collectFinderFontPaths can keep WOFF for Link to … and skip folders', () => {
  const collected = collectFinderFontPaths(
    ['/Fonts/A.otf', '/Fonts/B.woff2', '/Fonts/Folder', '/gone.ttf'],
    {
      includeWeb: true,
      allowDirectories: false,
      existsSync: (filePath) => filePath !== '/gone.ttf',
      statSync: (filePath) => ({
        isDirectory: () => filePath === '/Fonts/Folder',
      }),
    },
  )
  assert.deepEqual(collected.paths, ['/Fonts/A.otf', '/Fonts/B.woff2'])
  assert.deepEqual(collected.skippedWeb, [])
  assert.deepEqual(collected.missing, ['/gone.ttf'])
})

test('install-as helpers reuse destination labels and the existing eligible-install statuses', () => {
  const choices = destinationChoices([
    { id: 'macos', supported: true },
    { id: 'adobe-shared', supported: true },
  ])
  assert.deepEqual(
    choices.map((item) => item.label),
    ['This Mac', 'Adobe folder', 'This Mac and Adobe folder'],
  )
  assert.deepEqual(destinationChoices([{ id: 'adobe-shared', supported: false }]), [
    { id: 'macos', label: 'This Mac', destinationIds: ['macos'] },
  ])
  assert.match(familyNamePromptScript('Display "Sans"'), /Display \\"Sans\\"/)
  assert.match(familyNamePromptScript('Inter'), /Install renamed copy/)
  const entries = [
    { id: 'one', status: 'uninstalled', format: 'otf', faces: [{ familyName: 'Display' }] },
    { id: 'two', status: 'installed', format: 'otf', faces: [{ familyName: 'Display' }] },
    { id: 'web', status: 'uninstalled', previewOnly: true, format: 'woff' },
    { id: 'three', status: 'deactivated', format: 'ttf' },
  ]
  assert.deepEqual(idsEligibleForFinderInstall(entries), ['one', 'three'])
  assert.equal(suggestedFamilyName(entries), 'Display')
  assert.deepEqual(groupIdsByFormat(entries.filter((entry) => entry.id === 'one' || entry.id === 'three')), [
    ['one'],
    ['three'],
  ])
})

test('finder services addon compile is skipped off macOS', () => {
  const result = compileFinderServicesAddon()
  if (process.platform === 'darwin') {
    assert.equal(result.skipped, false)
    return
  }
  assert.equal(result.ok, false)
  assert.equal(result.skipped, true)
})

test('Electron main handles Finder services through the existing install APIs', () => {
  const main = readRepo('electron/main.mjs')
  const preload = readRepo('electron/preload.cjs')
  const relink = readRepo('src/components/RelinkDialog.tsx')
  const app = readRepo('src/App.tsx')
  const native = readRepo('electron/finder-services.mm')
  assert.match(main, /parseFinderLaunch/)
  assert.match(main, /app\.on\('open-url'/)
  assert.match(main, /\/api\/import/)
  assert.match(main, /\/api\/install/)
  assert.match(main, /finder-services\.node/)
  assert.match(main, /Install as…/)
  assert.match(main, /finder-link-to/)
  assert.match(main, /Link to …/)
  assert.doesNotMatch(main, /\/api\/relink/)
  assert.doesNotMatch(main, /CSC_IDENTITY_AUTO_DISCOVERY/)
  assert.match(preload, /onFinderLinkTo/)
  assert.match(app, /onFinderLinkTo/)
  assert.match(relink, /Link to …/)
  assert.match(relink, /inspectRelink/)
  assert.match(relink, /applyRelink/)
  assert.match(relink, /Search catalog families/)
  assert.match(relink, /pairFinderFilesToFamily/)
  assert.match(relink, /Already linked/)
  assert.match(app, /onAdvance/)
  assert.match(native, /linkFonts/)
  assert.equal(
    CLAIMED_FONT_EXTENSIONS.join(','),
    'ttf,otf,ttc,otc,woff,woff2',
  )
})
