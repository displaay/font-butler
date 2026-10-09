import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Hidden, non-font suffix so fontd does not activate the temporary file. */
export const ATOMIC_FONT_TEMP_SUFFIX = '.fontbutler-tmp'

/**
 * Directory macOS activates on its own. `FONT_BUTLER_USER_FONTS_DIR` is a test seam
 * so unit tests can exercise this path without writing into the real Library folder.
 */
export function macUserFontsRoot(): string {
  const override = process.env.FONT_BUTLER_USER_FONTS_DIR
  if (override && override.trim()) return path.resolve(override)
  return path.join(os.homedir(), 'Library', 'Fonts')
}

export function isMacUserFontFile(filePath: string): boolean {
  if (!filePath) return false
  const root = macUserFontsRoot()
  const resolved = path.resolve(filePath)
  if (resolved === root) return false
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  return resolved.startsWith(prefix)
}

/**
 * Copy to a sibling temp file, then rename over the destination.
 * Same-directory rename replaces the directory entry, so the live path gets a new inode.
 * An in-place copy keeps the old inode and leaves fontd serving the previous outlines.
 */
export async function replaceFontFileAtomically(source: string, dest: string): Promise<void> {
  const temp = path.join(path.dirname(dest), `.${crypto.randomUUID()}${ATOMIC_FONT_TEMP_SUFFIX}`)
  try {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })
    await fs.promises.copyFile(source, temp)
    await fs.promises.rename(temp, dest)
  } finally {
    if (fs.existsSync(temp)) {
      fs.rmSync(temp, { force: true })
    }
  }
}
