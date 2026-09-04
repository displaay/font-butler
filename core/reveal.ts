import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { isMac } from './paths.ts'

const execFileAsync = promisify(execFile)

export async function moveToTrash(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(resolved)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(resolved)
    return
  }
  if (isMac()) {
    try {
      await execFileAsync('osascript', [
        '-e',
        `tell application "Finder" to delete POSIX file ${JSON.stringify(resolved)}`,
      ])
      return
    } catch {
      // Fall through to a direct delete when Finder is unavailable.
    }
  }
  fs.rmSync(resolved, { force: true })
}

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
