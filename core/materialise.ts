import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertSafeShellPath } from './auth.ts'
import { pythonScriptArgv, resolvePythonRuntime, type PythonRuntime } from './python-runtime.ts'

const execFileAsync = promisify(execFile)

export type MaterialiseReport = {
  selectedFeatures?: string[]
  appliedFeatures: string[]
  skippedWarnings: string[]
  mapping: Array<{ source?: string; replacement?: string }>
  errors: string[]
  warnings: string[]
  changed: boolean
  inputPath?: string
  outputPath?: string
}

export function resolveMaterialiseRuntime(options?: {
  resourcesPath?: string
  root?: string
}): PythonRuntime | null {
  return resolvePythonRuntime('materialise_feature.py', options)
}

export function materialisePythonArgv(
  runtime: PythonRuntime,
  sourcePath: string,
  destPath: string,
  features: string[],
): string[] {
  return pythonScriptArgv(runtime, [
    assertSafeShellPath(sourcePath),
    assertSafeShellPath(destPath),
    ...features,
  ])
}

function parseReport(stdout: string): MaterialiseReport {
  const trimmed = stdout.trim()
  const start = trimmed.indexOf('{')
  const payload = start >= 0 ? trimmed.slice(start) : trimmed
  const parsed = JSON.parse(payload) as MaterialiseReport
  return {
    selectedFeatures: parsed.selectedFeatures ?? [],
    appliedFeatures: parsed.appliedFeatures ?? [],
    skippedWarnings: parsed.skippedWarnings ?? [],
    mapping: parsed.mapping ?? [],
    errors: parsed.errors ?? [],
    warnings: parsed.warnings ?? [],
    changed: Boolean(parsed.changed),
    inputPath: parsed.inputPath,
    outputPath: parsed.outputPath,
  }
}

export async function materialiseFeatureCopy(
  sourcePath: string,
  features: string[],
): Promise<{ destPath: string; report: MaterialiseReport }> {
  const runtime = resolveMaterialiseRuntime()
  if (!runtime) {
    throw new Error('Bundled fonttools runtime was not found.')
  }
  const ext = path.extname(sourcePath) || '.ttf'
  const destPath = path.join(
    os.tmpdir(),
    `font-butler-bake-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  )
  let stdout = ''
  let stderr = ''
  try {
    const result = await execFileAsync(
      runtime.command,
      materialisePythonArgv(runtime, sourcePath, destPath, features),
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    )
    stdout = result.stdout
    stderr = result.stderr
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: string }).stderr || (error as { stdout?: string }).stdout || '')
        : error instanceof Error
          ? error.message
          : 'Python materialise failed'
    const stdoutFromError =
      error && typeof error === 'object' && 'stdout' in error
        ? String((error as { stdout?: string }).stdout || '')
        : ''
    if (stdoutFromError.trim().startsWith('{') || stdoutFromError.includes('{')) {
      const report = parseReport(stdoutFromError)
      if (report.errors.length) {
        throw new Error(report.errors.join('\n'))
      }
    }
    throw new Error(detail.trim() || 'Could not bake OpenType features.')
  }
  const report = parseReport(stdout || '{}')
  if (report.errors.length) {
    if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true })
    throw new Error(report.errors.join('\n'))
  }
  if (stderr.trim() && !report.changed) {
    report.warnings = [...(report.warnings ?? []), stderr.trim()]
  }
  if (report.changed && !fs.existsSync(destPath)) {
    throw new Error('Python materialise finished but no output file was written.')
  }
  return { destPath, report }
}
