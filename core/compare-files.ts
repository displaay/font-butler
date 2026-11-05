import fs from 'node:fs'
import path from 'node:path'
import { isPreviewableFontFile, parseFontFile } from './parse.ts'
import { familyIdForName, type CompareFace, type CompareFamily } from '../shared/compare.ts'

const FONT_WALK_DEPTH = 8
const FONT_WALK_LIMIT = 200

export type CompareInspectResult = {
  families: CompareFamily[]
  /** Real font files that may be served for this comparison. */
  paths: string[]
  errors: string[]
}

function fontExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

function remember(paths: string[], seen: Set<string>, filePath: string) {
  if (seen.has(filePath) || paths.length >= FONT_WALK_LIMIT) return
  seen.add(filePath)
  paths.push(filePath)
}

/**
 * Font files named by the user, including files inside a dropped folder.
 * Symlink directories are not walked. A symlink to a font file resolves to
 * that file. Nothing is copied into the catalog.
 */
export function collectCompareFontFiles(inputs: string[]): { paths: string[]; errors: string[] } {
  const paths: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  function visit(input: string, depth: number) {
    if (paths.length >= FONT_WALK_LIMIT) return
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(input)
    } catch {
      errors.push(`${input}: file not found.`)
      return
    }
    if (stat.isSymbolicLink()) {
      let real: string
      try {
        real = fs.realpathSync(input)
        if (!fs.statSync(real).isFile() || !isPreviewableFontFile(real)) {
          errors.push(`${input}: not a font file.`)
          return
        }
      } catch {
        errors.push(`${input}: file not found.`)
        return
      }
      remember(paths, seen, real)
      return
    }
    if (stat.isDirectory()) {
      if (depth >= FONT_WALK_DEPTH) {
        errors.push(`${input}: folder is nested too deep to compare.`)
        return
      }
      let names: string[]
      try {
        names = fs.readdirSync(input)
      } catch {
        errors.push(`${input}: folder could not be read.`)
        return
      }
      for (const name of names) {
        if (!name || name.startsWith('.')) continue
        visit(path.join(input, name), depth + 1)
        if (paths.length >= FONT_WALK_LIMIT) {
          errors.push('Only the first 200 font files were added.')
          return
        }
      }
      return
    }
    if (!stat.isFile() || !isPreviewableFontFile(input)) {
      errors.push(`${input}: not a font file.`)
      return
    }
    try {
      remember(paths, seen, fs.realpathSync(input))
    } catch {
      errors.push(`${input}: file not found.`)
    }
  }

  for (const raw of inputs) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    visit(path.resolve(raw.trim()), 0)
  }
  return { paths, errors }
}

function faceId(filePath: string, index: number): string {
  return `${filePath}#${index}`
}

/**
 * Read font files for Compare. Callers do not pass a catalog: a file that
 * was never imported is a normal result.
 */
export function inspectCompareFiles(inputs: string[]): CompareInspectResult {
  const collected = collectCompareFontFiles(inputs)
  const families: CompareFamily[] = []
  const byId = new Map<string, CompareFamily>()

  for (const filePath of collected.paths) {
    if (!isPreviewableFontFile(filePath) || fontExtension(filePath) === '') continue
    let parsed
    try {
      parsed = parseFontFile(filePath, { previewMeta: false, previewSample: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read font'
      collected.errors.push(`${filePath}: ${message}`)
      continue
    }
    parsed.faces.forEach((face, index) => {
      const name = face.familyName?.trim() || path.basename(filePath, path.extname(filePath))
      const id = familyIdForName(name)
      let family = byId.get(id)
      if (!family) {
        family = { id, name, faces: [] }
        byId.set(id, family)
        families.push(family)
      }
      const compareFace: CompareFace = {
        id: faceId(filePath, index),
        styleName: face.styleName?.trim() || 'Regular',
        weight: face.weight || 400,
        italic: Boolean(face.italic),
        postscriptName: face.postscriptName || '',
        filePath,
        faceIndex: index,
        isVariable: Boolean(face.isVariable),
      }
      if (!family.faces.some((item) => item.id === compareFace.id)) family.faces.push(compareFace)
    })
  }

  return {
    families,
    paths: collected.paths.filter((filePath) => families.some((family) => family.faces.some((face) => face.filePath === filePath))),
    errors: collected.errors,
  }
}
