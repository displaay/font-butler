import fs from 'node:fs'
import path from 'node:path'
import { create, openSync } from 'fontkit'
import type { Font, FontCollection } from 'fontkit'
import { FONT_EXTENSIONS, type FontFaceInfo } from './types.ts'

export function isFontFile(filePath: string): boolean {
  return FONT_EXTENSIONS.includes(
    path.extname(filePath).toLowerCase() as (typeof FONT_EXTENSIONS)[number],
  )
}

function isCollection(font: Font | FontCollection): font is FontCollection {
  return 'fonts' in font && Array.isArray((font as FontCollection).fonts)
}

function namedInstanceCount(font: Font): { count: number; names: string[] } {
  const named = (font as Font & { namedVariations?: Record<string, unknown> })
    .namedVariations
  const names = named ? Object.keys(named) : []
  return { count: Math.max(names.length, 1), names }
}

function faceFromFont(font: Font): FontFaceInfo {
  const axes = font.variationAxes ?? {}
  const isVariable = Object.keys(axes).length > 0
  const instances = isVariable
    ? namedInstanceCount(font)
    : { count: 1, names: [] }
  const os2 = font['OS/2']
  const italicAngle = font.italicAngle ?? 0
  const styleName = font.subfamilyName || 'Regular'

  return {
    familyName: font.familyName || 'Unknown',
    styleName,
    fullName: font.fullName || `${font.familyName ?? 'Unknown'} ${styleName}`,
    postscriptName: font.postscriptName || '',
    isVariable,
    instanceCount: isVariable ? instances.count : 1,
    instanceNames: instances.names,
    weight: os2?.usWeightClass ?? 400,
    italic: Math.abs(italicAngle) > 1 || /italic|oblique/i.test(styleName),
  }
}

export type ParsedFont = {
  faces: FontFaceInfo[]
  format: string
}

export function parseFontFile(filePath: string): ParsedFont {
  const opened = openSync(filePath)
  return parseOpened(opened, path.extname(filePath).slice(1).toLowerCase())
}

export function parseFontBuffer(buffer: Buffer, formatHint = 'ttf'): ParsedFont {
  const opened = create(buffer)
  return parseOpened(opened, formatHint)
}

function parseOpened(opened: Font | FontCollection, format: string): ParsedFont {
  if (isCollection(opened)) {
    return {
      format: format || 'ttc',
      faces: opened.fonts.map((font) => faceFromFont(font)),
    }
  }
  return {
    format: opened.type?.toLowerCase() === 'woff' || opened.type?.toLowerCase() === 'woff2'
      ? opened.type.toLowerCase()
      : format || 'ttf',
    faces: [faceFromFont(opened)],
  }
}

export function readFileStat(filePath: string): { mtimeMs: number; size: number } {
  const stat = fs.statSync(filePath)
  return { mtimeMs: stat.mtimeMs, size: stat.size }
}

export function mimeForFont(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.otf':
      return 'font/otf'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttc':
    case '.otc':
      return 'font/collection'
    default:
      return 'font/ttf'
  }
}
