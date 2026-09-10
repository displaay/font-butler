import fs from 'node:fs'
import path from 'node:path'
import { projectRoot } from './paths.ts'

export type PythonRuntime = {
  command: string
  script: string
  source: 'bundled' | 'system'
}

function processResourcesPath(): string {
  const value = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return typeof value === 'string' ? value : ''
}

export function resolvePythonRuntime(
  scriptName: string,
  {
    resourcesPath = processResourcesPath(),
    root = projectRoot,
  }: {
    resourcesPath?: string
    root?: string
  } = {},
): PythonRuntime | null {
  const projectScript = path.join(root, 'scripts', scriptName)
  const candidates: PythonRuntime[] = [
    {
      command: path.join(resourcesPath, 'python', 'bin', 'python3'),
      script: path.join(resourcesPath, 'python', scriptName),
      source: 'bundled',
    },
    {
      command: path.join(root, 'vendor/python/bin/python3'),
      script: path.join(root, 'vendor/python', scriptName),
      source: 'bundled',
    },
    {
      command: 'python3',
      script: projectScript,
      source: 'system',
    },
  ]
  for (const candidate of candidates) {
    const commandReady =
      candidate.command === 'python3' || fs.existsSync(candidate.command)
    if (commandReady && fs.existsSync(candidate.script)) {
      return candidate
    }
  }
  return null
}

export function pythonScriptArgv(runtime: PythonRuntime, args: string[]): string[] {
  const isolated = runtime.source === 'bundled' ? ['-I'] : []
  return [...isolated, runtime.script, '--', ...args]
}
