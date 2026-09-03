import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { isMac } from './paths.ts'

const execFileAsync = promisify(execFile)

export async function revealInFileManager(targetPath: string): Promise<void> {
  if (!fs.existsSync(targetPath)) {
    throw new Error('That file is no longer on disk.')
  }
  if (isMac()) {
    await execFileAsync('open', ['-R', targetPath])
    return
  }
  const folder = fs.statSync(targetPath).isDirectory()
    ? targetPath
    : path.dirname(targetPath)
  try {
    await execFileAsync('xdg-open', [folder])
  } catch {
    throw new Error(folder)
  }
}
