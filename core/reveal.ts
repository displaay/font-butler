import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { isMac } from './paths.ts'

const execFileAsync = promisify(execFile)

export type DesktopShell = {
  reveal(targetPath: string): Promise<void>
  moveToTrash(filePath: string): Promise<void>
}

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout?: string; stderr?: string }>

export function testDesktopShell(): DesktopShell {
  return {
    async reveal() {},
    async moveToTrash(filePath) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true })
      }
    },
  }
}

export function realDesktopShell(run: ExecFileFn = execFileAsync): DesktopShell {
  return {
    async reveal(targetPath) {
      if (isMac()) {
        await run('open', ['-R', targetPath])
        return
      }
      const folder = fs.statSync(targetPath).isDirectory()
        ? targetPath
        : path.dirname(targetPath)
      await run('xdg-open', [folder])
    },
    async moveToTrash(filePath) {
      try {
        await run('osascript', [
          '-e',
          `tell application "Finder" to delete POSIX file ${JSON.stringify(filePath)}`,
        ])
      } catch {
        throw new Error('Finder could not move that file to Trash.')
      }
    },
  }
}

function defaultShell(): DesktopShell {
  if (process.env.FONT_BUTLER_TEST === '1' && process.env.FONT_BUTLER_SHELL !== '1') {
    return testDesktopShell()
  }
  return realDesktopShell()
}

let current: DesktopShell | null = null

export function getDesktopShell(): DesktopShell {
  return current ?? defaultShell()
}

export function setDesktopShell(adapter: DesktopShell | null): void {
  current = adapter
}

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
  if (!stat.isFile()) {
    throw new Error('That source path is not a file.')
  }
  await getDesktopShell().moveToTrash(resolved)
}

export async function revealInFileManager(targetPath: string): Promise<void> {
  if (!fs.existsSync(targetPath)) {
    throw new Error('That file is no longer on disk.')
  }
  await getDesktopShell().reveal(targetPath)
}
