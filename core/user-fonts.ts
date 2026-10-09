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

async function sameDevice(leftDir: string, rightDir: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([fs.promises.stat(leftDir), fs.promises.stat(rightDir)])
    return left.dev === right.dev
  } catch {
    return false
  }
}

/**
 * Copy to a hidden temp file, then rename over the destination.
 * The temp lives in the staging directory when that directory is on the same volume,
 * so the final rename stays atomic and the live path gets a new inode.
 * An in-place copy keeps the old inode and leaves fontd serving the previous outlines.
 */
export async function replaceFontFileAtomically(source: string, dest: string): Promise<void> {
  const destDir = path.dirname(dest)
  await fs.promises.mkdir(destDir, { recursive: true })
  const stagingDir = path.dirname(source)
  const tempDir = (await sameDevice(stagingDir, destDir)) ? stagingDir : destDir
  const temp = path.join(tempDir, `.${crypto.randomUUID()}${ATOMIC_FONT_TEMP_SUFFIX}`)
  let sibling: string | undefined
  try {
    await fs.promises.copyFile(source, temp)
    try {
      await fs.promises.rename(temp, dest)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EXDEV') throw error
      sibling = path.join(destDir, `.${crypto.randomUUID()}${ATOMIC_FONT_TEMP_SUFFIX}`)
      await fs.promises.copyFile(temp, sibling)
      await fs.promises.rm(temp, { force: true })
      await fs.promises.rename(sibling, dest)
    }
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined)
    if (sibling) await fs.promises.rm(sibling, { force: true }).catch(() => undefined)
  }
}
