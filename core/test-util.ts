import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppPaths } from './paths.ts'
import { setFontNative, noopFontNative, type FontNative } from './native.ts'
import { setDesktopShell, testDesktopShell } from './reveal.ts'
import { FontButlerService } from './service.ts'
import { closeAllWatchers } from './watch.ts'

export function tempPaths(prefix = 'font-butler-'): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const userFontsDir = path.join(dataRoot, 'user-fonts')
  return {
    dataRoot,
    catalogPath: path.join(dataRoot, 'catalog.json'),
    settingsPath: path.join(dataRoot, 'settings.json'),
    apiTokenPath: path.join(dataRoot, 'token'),
    installDir: userFontsDir,
    disabledDir: path.join(dataRoot, 'disabled'),
    sourcesDir: path.join(dataRoot, 'sources'),
    uploadsDir: path.join(dataRoot, 'uploads'),
    systemCachePath: path.join(dataRoot, 'system.json'),
    seedDir: path.join(dataRoot, 'seed'),
    userFontsDir,
    computerFontsDir: path.join(dataRoot, 'computer-fonts'),
    systemFontsDir: path.join(dataRoot, 'system-fonts'),
    supplementalFontsDir: path.join(dataRoot, 'supplemental'),
    officeFontCacheDir: path.join(dataRoot, 'office-cache'),
    atsCacheDir: path.join(dataRoot, 'ats-cache'),
    adobeFontsDir: path.join(dataRoot, 'adobe-fonts'),
  }
}

export type TestFontFaceSpec = {
  family: string
  psName: string
  style?: string
  format?: 'ttf' | 'otf'
  version?: string
  weight?: number
}

export function writeTestFont(
  dest: string,
  family: string,
  psName: string,
  options: { style?: string; format?: 'ttf' | 'otf'; version?: string; weight?: number } = {},
): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const style = options.style ?? 'Regular'
  const format = options.format ?? 'ttf'
  const version = options.version ?? 'Version 1.000'
  const weight = options.weight ?? (/bold/i.test(style) ? 700 : 400)
  const isTtf = format === 'ttf'
  const script = isTtf
    ? `
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder([".notdef", "A"])
fb.setupCharacterMap({65: "A"})
empty = TTGlyphPen(None).glyph()
pen = TTGlyphPen(None)
pen.moveTo((0, 0))
pen.lineTo((500, 0))
pen.lineTo((250, 700))
pen.closePath()
fb.setupGlyf({".notdef": empty, "A": pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (600, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({
    "familyName": ${JSON.stringify(family)},
    "styleName": ${JSON.stringify(style)},
    "uniqueFontIdentifier": ${JSON.stringify(psName)},
    "fullName": ${JSON.stringify(`${family} ${style}`)},
    "psName": ${JSON.stringify(psName)},
    "version": ${JSON.stringify(version)},
})
fb.setupOS2(usWeightClass=${weight})
fb.setupPost()
fb.save(${JSON.stringify(dest)})
`
    : `
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen

fb = FontBuilder(1000, isTTF=False)
fb.setupGlyphOrder([".notdef", "A"])
fb.setupCharacterMap({65: "A"})
empty_pen = T2CharStringPen(500, None)
empty = empty_pen.getCharString()
pen = T2CharStringPen(600, None)
pen.moveTo((0, 0))
pen.lineTo((500, 0))
pen.lineTo((250, 700))
pen.closePath()
charstring = pen.getCharString()
fb.setupCFF(${JSON.stringify(psName)}, {"FullName": ${JSON.stringify(`${family} ${style}`)}}, {".notdef": empty, "A": charstring}, {})
fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (600, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({
    "familyName": ${JSON.stringify(family)},
    "styleName": ${JSON.stringify(style)},
    "uniqueFontIdentifier": ${JSON.stringify(psName)},
    "fullName": ${JSON.stringify(`${family} ${style}`)},
    "psName": ${JSON.stringify(psName)},
    "version": ${JSON.stringify(version)},
})
fb.setupOS2(usWeightClass=${weight})
fb.setupPost()
fb.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

export function writeTestCollection(dest: string, faces: TestFontFaceSpec[]): void {
  if (faces.length < 2) {
    throw new Error('A collection fixture needs at least two faces.')
  }
  const collectionFormat = dest.toLowerCase().endsWith('.otc') ? 'otf' : 'ttf'
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-collection-'))
  try {
    const parts = faces.map((face, index) => {
      const format = face.format ?? collectionFormat
      const part = path.join(dir, `face-${index}.${format}`)
      writeTestFont(part, face.family, face.psName, {
        style: face.style,
        format,
        version: face.version,
        weight: face.weight,
      })
      return part
    })
    execFileSync(
      'python3',
      [
        '-c',
        `
from fontTools.ttLib import TTCollection, TTFont
ttc = TTCollection()
ttc.fonts = [${parts.map((part) => `TTFont(${JSON.stringify(part)})`).join(', ')}]
ttc.save(${JSON.stringify(dest)})
`,
      ],
      { stdio: 'pipe' },
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function writeTestWebFont(dest: string, family: string, psName: string): void {
  const ttf = dest.replace(/\.woff2?$/i, '.ttf')
  writeTestFont(ttf, family, psName)
  execFileSync(
    'python3',
    [
      '-c',
      `
from fontTools.ttLib import TTFont
font = TTFont(${JSON.stringify(ttf)})
font.flavor = "woff"
font.save(${JSON.stringify(dest)})
`,
    ],
    { stdio: 'pipe' },
  )
}

export async function withService<T>(
  fn: (service: FontButlerService, paths: AppPaths) => Promise<T>,
  options: { native?: FontNative; prefix?: string } = {},
): Promise<T> {
  const paths = tempPaths(options.prefix)
  const previous = options.native
  if (options.native) {
    setFontNative(options.native)
  } else {
    setFontNative(noopFontNative())
  }
  setDesktopShell(testDesktopShell())
  const service = new FontButlerService(paths)
  try {
    return await fn(service, paths)
  } finally {
    service.dispose()
    await closeAllWatchers()
    setFontNative(previous ?? null)
    setDesktopShell(null)
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
}
