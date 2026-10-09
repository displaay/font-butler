import fs from 'node:fs'

export const DATALESS_FONT_ERROR =
  'That font is still a cloud placeholder and cannot be previewed yet.'

/** Dropbox/iCloud placeholders report a size but no allocated blocks. */
export function isDatalessFontFile(filePath: string): boolean {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return false
  }
  return stat.isFile() && stat.size > 0 && stat.blocks === 0
}

/** Read preview bytes, or throw before readFileSync when the file is still a placeholder. */
export function readMaterializedFontBytes(filePath: string): Buffer {
  if (isDatalessFontFile(filePath)) {
    throw new Error(DATALESS_FONT_ERROR)
  }
  return fs.readFileSync(filePath)
}
