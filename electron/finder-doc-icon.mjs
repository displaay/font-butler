export const FINDER_DOC_ICON = 'finderDocIcon'
export const FINDER_DOC_ICON_FILE = 'finderDocIcon.icns'
export const FINDER_DOC_SVG = 'build/finderDocIcon.svg'

export const CLAIMED_FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2']

/** Best-effort system UTIs for the font roles we already claim by extension. */
export const SYSTEM_FONT_UTIS = {
  ttf: ['public.truetype-ttf-font'],
  otf: ['public.opentype-font'],
}

export const FINDER_DOC_PNG_SIZES = [16, 32, 128, 256, 512, 1024]

export function finderDocPngName(size) {
  return `finderDocIcon-${size}.png`
}

export function withFinderDocIcon(associations) {
  return associations.map((association) => ({
    ...association,
    icon: FINDER_DOC_ICON,
  }))
}

export function systemFontDocumentTypes() {
  return Object.entries(SYSTEM_FONT_UTIS).map(([ext, utis]) => ({
    CFBundleTypeName: ext === 'otf' ? 'OpenType Font' : 'TrueType Font',
    CFBundleTypeRole: 'Editor',
    LSHandlerRank: 'Default',
    LSItemContentTypes: utis,
    CFBundleTypeIconFile: FINDER_DOC_ICON_FILE,
  }))
}
