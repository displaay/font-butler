/**
 * Filesystem access that can read and delete real `app.asar` archives.
 *
 * Inside Electron, `node:fs` treats any path containing `.asar` as a virtual
 * directory. `readFileSync('.../app.asar')` then throws ENOENT, and a recursive
 * delete stops on the archive. `original-fs` is the unpatched filesystem.
 * This stays off the global `process.noAsar` switch, which would change every
 * other filesystem call in the process.
 *
 * Node methods are captured at load. A later stub of `fs.readFileSync` (the
 * asar shim in tests) does not replace the raw read.
 */
import nodeFs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const nodeRaw = {
  readFileSync: nodeFs.readFileSync.bind(nodeFs),
  rmSync: nodeFs.rmSync.bind(nodeFs),
}

export function rawFs() {
  if (process.versions?.electron) return require('original-fs')
  return nodeRaw
}
