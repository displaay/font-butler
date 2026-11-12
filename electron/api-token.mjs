import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP_FOLDER_NAME, LEGACY_APP_FOLDER_NAMES } from './mac-data-migration.mjs'

export function apiTokenFileCandidates({
  platform = process.platform,
  home = os.homedir(),
  cwd = process.cwd(),
  dataOverride = process.env.FONT_BUTLER_DATA ?? process.env.FONTCASE_DATA,
} = {}) {
  if (dataOverride) return [path.join(dataOverride, 'api-token')]
  if (platform === 'darwin') {
    const root = path.join(home, 'Library/Application Support')
    return [APP_FOLDER_NAME, ...LEGACY_APP_FOLDER_NAMES].map((name) => path.join(root, name, 'api-token'))
  }
  return [path.join(cwd, '.font-butler-data', 'api-token')]
}

export function apiTokenFilePath(options) {
  return apiTokenFileCandidates(options)[0]
}

function readOneApiToken(filePath) {
  try {
    const token = fs.readFileSync(filePath, 'utf8').trim()
    return token.length >= 16 ? token : null
  } catch {
    return null
  }
}

/**
 * An explicit path is read as-is. The default lookup uses Cuttler, then a
 * token left in Font Buttler or Font Butler when a stall kept that folder.
 */
export function readApiTokenFile(filePath, options) {
  if (typeof filePath === 'string' && filePath) return readOneApiToken(filePath)
  for (const candidate of apiTokenFileCandidates(options)) {
    const token = readOneApiToken(candidate)
    if (token) return token
  }
  return null
}
