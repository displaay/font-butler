import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function apiTokenFilePath({
  platform = process.platform,
  home = os.homedir(),
  cwd = process.cwd(),
  dataOverride = process.env.FONT_BUTLER_DATA ?? process.env.FONTCASE_DATA,
} = {}) {
  if (dataOverride) {
    return path.join(dataOverride, 'api-token')
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library/Application Support/Font Buttler', 'api-token')
  }
  return path.join(cwd, '.font-butler-data', 'api-token')
}

export function readApiTokenFile(filePath = apiTokenFilePath()) {
  try {
    const token = fs.readFileSync(filePath, 'utf8').trim()
    return token.length >= 16 ? token : null
  } catch {
    return null
  }
}
