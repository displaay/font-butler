import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEBUG_LOG_RING_MAX = 2000
const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024

const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi
const RETAIL_TOKEN_JSON_RE = /("token"\s*:\s*")([^"]+)(")/gi

export function redactDebugLogLine(text, secretValues = []) {
  let out = String(text)
  out = out.replace(BEARER_RE, 'Bearer [redacted]')
  out = out.replace(RETAIL_TOKEN_JSON_RE, '$1[redacted]$3')
  for (const secret of secretValues) {
    if (!secret || secret.length < 8) continue
    out = out.split(secret).join('[redacted]')
  }
  return out
}

export function formatDebugLogLine(source, message, now = new Date()) {
  const ts = now.toISOString()
  const tag = source.padEnd(12).slice(0, 12)
  return `${ts} [${tag}] ${message}`
}

export function createDebugLogStore(options = {}) {
  const ringMax = options.ringMax ?? DEBUG_LOG_RING_MAX
  const lines = []
  const listeners = new Set()
  const secretValues = new Set(options.secrets ?? [])

  function registerSecrets(values) {
    for (const value of values) {
      if (value) secretValues.add(String(value))
    }
  }

  function appendRaw(source, message, now = new Date()) {
    const redacted = redactDebugLogLine(message, [...secretValues])
    const line = formatDebugLogLine(source, redacted, now)
    lines.push(line)
    while (lines.length > ringMax) {
      lines.shift()
    }
    for (const listener of listeners) {
      listener(line)
    }
    return line
  }

  function append(source, message, now = new Date()) {
    return appendRaw(source, message, now)
  }

  function getSnapshot() {
    return [...lines]
  }

  function getText() {
    return lines.join('\n')
  }

  function clear() {
    lines.length = 0
    for (const listener of listeners) {
      listener(null)
    }
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    append,
    appendRaw,
    getSnapshot,
    getText,
    clear,
    subscribe,
    registerSecrets,
    _lines: lines,
  }
}

export function defaultLogFilePath(homeDir = os.homedir(), platform = process.platform) {
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Logs', 'Font Buttler', 'main.log')
  }
  return path.join(homeDir, '.local', 'state', 'Font Buttler', 'logs', 'main.log')
}

export function rotateLogFileIfNeeded(filePath, maxBytes = LOG_FILE_MAX_BYTES) {
  try {
    if (!fs.existsSync(filePath)) return
    const stat = fs.statSync(filePath)
    if (stat.size <= maxBytes) return
    const rotated = `${filePath}.1`
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
    fs.renameSync(filePath, rotated)
  } catch {
    // Best-effort rotation only.
  }
}

export function createDebugLogFileWriter(filePath, options = {}) {
  const maxBytes = options.maxBytes ?? LOG_FILE_MAX_BYTES
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  } catch {
    // Best-effort: logging must not block app startup.
  }
  rotateLogFileIfNeeded(filePath, maxBytes)

  return {
    filePath,
    writeLine(line) {
      try {
        rotateLogFileIfNeeded(filePath, maxBytes)
        fs.appendFileSync(filePath, `${line}\n`, 'utf8')
      } catch {
        // Ignore log write failures.
      }
    },
  }
}

export function attachDebugLogPersistence(store, fileWriter) {
  return store.subscribe((line) => {
    if (line) fileWriter.writeLine(line)
  })
}
