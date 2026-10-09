import fs from 'node:fs'

export const DATALESS_FONT_ERROR =
  'That font is still a cloud placeholder and cannot be previewed yet.'

/**
 * APFS/HFS+ can report st_blocks 0 for a real file whose bytes live in the
 * decmpfs xattr. That is not enough to refuse a preview. Use it only to explain
 * a read that has already failed.
 */
export function isDatalessFontFile(filePath: string): boolean {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return false
  }
  return stat.isFile() && stat.size > 0 && stat.blocks === 0
}

/** Async preview read so a materializing file does not block the server. */
export async function readFontPreviewBytes(filePath: string): Promise<Buffer> {
  try {
    return await fs.promises.readFile(filePath)
  } catch (error) {
    if (isDatalessFontFile(filePath)) {
      throw new Error(DATALESS_FONT_ERROR)
    }
    throw error
  }
}
