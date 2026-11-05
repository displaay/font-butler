import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Live InDesign font lists, from Cicero's DocumentFontWatcher.
 * The native addon sends the Apple Events. These helpers only line the reply up.
 */

const require = createRequire(import.meta.url)
const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item : ''))
}

/**
 * Three parallel lists from InDesign: PostScript name, family, style.
 * Unequal lengths are an unusable reply. A blank style stays, so the lists line up.
 * A row with neither a PostScript name nor a family is left out.
 *
 * @param {{
 *   unavailable?: boolean
 *   refused?: boolean
 *   postscriptNames?: unknown
 *   families?: unknown
 *   styles?: unknown
 * } | null | undefined} reply
 */
export function fontsFromInDesignReply(reply) {
  if (!reply || reply.unavailable === true) {
    return { unavailable: true, refused: false, fonts: [] }
  }
  if (reply.refused === true) {
    return { unavailable: false, refused: true, fonts: [] }
  }
  const names = stringList(reply.postscriptNames)
  const families = stringList(reply.families)
  const styles = stringList(reply.styles)
  if (names.length !== families.length || names.length !== styles.length) {
    return { unavailable: false, refused: false, fonts: [] }
  }
  const fonts = []
  for (let index = 0; index < names.length; index += 1) {
    const postscriptName = names[index].trim()
    const familyName = families[index].trim()
    const styleName = styles[index].trim()
    if (!postscriptName && !familyName) continue
    fonts.push({ postscriptName, familyName, styleName })
  }
  return { unavailable: false, refused: false, fonts }
}

function addonCandidates() {
  const resourcesPath =
    'resourcesPath' in process && typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  return [
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked/electron/indesign-fonts.node') : '',
    path.join(moduleDir, 'indesign-fonts.node'),
  ]
}

function loadAddon() {
  if (process.platform !== 'darwin') return null
  for (const candidate of addonCandidates()) {
    if (!candidate || !fs.existsSync(candidate)) continue
    try {
      const addon = require(candidate)
      if (addon && typeof addon.askInDesignFonts === 'function') return addon
    } catch {
      return null
    }
  }
  return null
}

/** Ask one InDesign process. `unavailable` means this Mac cannot send the event. */
export async function askInDesignFonts(pid) {
  const addon = loadAddon()
  if (!addon) return { unavailable: true }
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) {
    return { refused: false, postscriptNames: [], families: [], styles: [] }
  }
  try {
    const reply = await addon.askInDesignFonts(id)
    if (!reply || typeof reply !== 'object') {
      return { refused: false, postscriptNames: [], families: [], styles: [] }
    }
    return reply
  } catch {
    return { refused: false, postscriptNames: [], families: [], styles: [] }
  }
}
