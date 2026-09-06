import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { faceIdentityKey, findByInstalledPath, findBySourcePath } from './catalog.ts'
import { occupyingSiblingsForIncoming, isBoundSourcePath, findAllByFaceIdentity } from './identity.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { isWebFontFormat, normalizeFormat } from './formats.ts'
import { isFontFile, isPreviewableFontFile, parseFontFile } from './parse.ts'
import { plansDir } from './paths.ts'
import type { AppPaths } from './paths.ts'
import type {
  CatalogEntry,
  CatalogFile,
  ImportPlan,
  ImportPlanChoice,
  ImportPlanItem,
  OperationTrigger,
} from './types.ts'

const PLAN_TTL_MS = 60 * 60 * 1000

export function classifyImportFile(
  filePath: string,
  catalog: CatalogFile,
  options: { paths?: AppPaths } = {},
): ImportPlanItem {
  const resolved = path.resolve(filePath)
  const id = crypto.randomUUID()
  const base: ImportPlanItem = {
    id,
    path: resolved,
    classification: 'unsupported',
    defaultChoice: 'skip',
    choices: ['skip'],
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ...base, reason: 'Not a file.' }
  }
  if (!isPreviewableFontFile(resolved) && !isFontFile(resolved)) {
    return { ...base, reason: 'Not a font file.' }
  }
  let parsed
  try {
    parsed = parseFontFile(resolved)
  } catch (error) {
    return {
      ...base,
      reason: error instanceof Error ? error.message : 'Could not read that font.',
    }
  }
  const fingerprint = tryFingerprintFile(resolved)
  const previewOnly = isWebFontFormat(parsed.format)
  const samePath =
    findByInstalledPath(catalog, resolved) ?? findBySourcePath(catalog, resolved)
  const identityMatches = findAllByFaceIdentity(catalog, parsed.faces, parsed.format)
  const sameIdentity = identityMatches[0]
  const sameFaceAnyFormat = findAllByFaceIdentity(catalog, parsed.faces)[0]
  const sameBytes = fingerprint
    ? catalog.entries.find((entry) => entry.sourceFingerprint === fingerprint || entry.installedFingerprint === fingerprint)
    : undefined
  const family = parsed.faces[0]?.familyName
  const sameFamilyDifferentFace = catalog.entries.find((entry) => {
    if (identityMatches.some((match) => match.id === entry.id)) return false
    const entryFamily = entry.customFamilyName || entry.faces[0]?.familyName
    if (!family || !entryFamily || entryFamily !== family) return false
    const key = faceIdentityKey(parsed.faces, parsed.format)
    const other = faceIdentityKey(entry.faces, entry.format)
    return Boolean(key && other && key !== other)
  })
  const stat = fs.statSync(resolved)

  const item: ImportPlanItem = {
    ...base,
    familyName: family,
    format: parsed.format,
    fingerprint,
    faces: parsed.faces,
    previewOnly,
    affectedFaces: parsed.faces.map((face) => `${face.familyName} ${face.styleName}`.trim()),
    sourceMtimeMs: stat.mtimeMs,
  }

  if (previewOnly) {
    if (samePath || (sameBytes && sameBytes.previewOnly)) {
      return {
        ...item,
        classification: 'identical',
        entryId: (samePath ?? sameBytes)?.id,
        defaultChoice: 'skip',
        choices: ['skip', 'relink'],
      }
    }
    return {
      ...item,
      classification: 'preview-only',
      defaultChoice: 'keep',
      choices: ['keep', 'skip'],
    }
  }

  if (samePath) {
    const bytesDiffer =
      fingerprint &&
      ((samePath.sourceFingerprint && samePath.sourceFingerprint !== fingerprint) ||
        (samePath.installedFingerprint && samePath.installedFingerprint !== fingerprint))
    if (bytesDiffer && samePath.status !== 'uninstalled' && samePath.status !== 'source-missing') {
      return finishRevision(item, samePath, identityMatches, { parallelCopy: false })
    }
    return {
      ...item,
      classification: 'identical',
      entryId: samePath.id,
      defaultChoice: 'skip',
      choices: ['skip'],
    }
  }

  if (sameBytes) {
    return {
      ...item,
      classification: 'identical',
      entryId: sameBytes.id,
      defaultChoice: 'skip',
      choices: ['skip', 'relink'],
      reason: 'Identical bytes are already in the library.',
    }
  }

  if (identityMatches.length) {
    const occupying = options.paths
      ? occupyingSiblingsForIncoming(catalog.entries, parsed.faces, parsed.format, options.paths)
      : identityMatches.filter((entry) => entry.status === 'installed' || entry.status === 'outdated')
    const bound = identityMatches.find((entry) => isBoundSourcePath(entry, resolved))
    const parallelCopy = !bound
    const preferred = occupying[0] ?? identityMatches[0]!
    return finishRevision(item, preferred, identityMatches, { parallelCopy })
  }

  if (sameFaceAnyFormat && normalizeFormat(sameFaceAnyFormat.format) !== normalizeFormat(parsed.format)) {
    const collection = parsed.faces.length > 1
    return {
      ...item,
      classification: collection ? 'collection-overlap' : 'alt-format',
      entryId: sameFaceAnyFormat.id,
      currentFormat: sameFaceAnyFormat.format,
      incomingVersion: parsed.faces[0]?.fullName,
      currentVersion: sameFaceAnyFormat.faces[0]?.fullName,
      affectedFaces: [
        ...parsed.faces.map((face) => `${face.familyName} ${face.styleName}`.trim()),
        ...sameFaceAnyFormat.faces.map((face) => `${face.familyName} ${face.styleName}`.trim()),
      ],
      defaultChoice: 'keep',
      choices: ['keep', 'replace', 'install-as', 'skip'],
    }
  }

  if (sameFamilyDifferentFace) {
    return {
      ...item,
      classification: 'new-style',
      entryId: sameFamilyDifferentFace.id,
      defaultChoice: 'keep',
      choices: ['keep', 'skip'],
    }
  }

  return {
    ...item,
    classification: 'new',
    defaultChoice: 'keep',
    choices: ['keep', 'skip'],
  }
}

function finishRevision(
  item: ImportPlanItem,
  existing: CatalogEntry,
  siblings: CatalogEntry[] = [existing],
  options: { parallelCopy: boolean },
): ImportPlanItem {
  const siblingIds = [...new Set(siblings.map((entry) => entry.id))]
  if (options.parallelCopy) {
    return {
      ...item,
      classification: 'revision',
      entryId: existing.id,
      currentFormat: existing.format,
      currentVersion: existing.faces[0]?.fullName,
      incomingVersion: item.faces?.[0]?.fullName,
      parallelCopy: true,
      siblingEntryIds: siblingIds,
      defaultChoice: 'skip',
      choices: ['replace', 'add-inactive', 'install-as', 'switch', 'skip'],
      reason:
        'Another copy of this font is already active. Add an inactive copy under the real family name, Install as… a different name, replace, or skip.',
    }
  }
  return {
    ...item,
    classification: 'revision',
    entryId: existing.id,
    currentFormat: existing.format,
    currentVersion: existing.faces[0]?.fullName,
    incomingVersion: item.faces?.[0]?.fullName,
    parallelCopy: false,
    siblingEntryIds: siblingIds,
    defaultChoice: 'keep',
    choices: ['keep', 'replace', 'skip'],
  }
}

export function buildImportPlan(
  filePaths: string[],
  catalog: CatalogFile,
  options: { trigger?: OperationTrigger; folderId?: string; paths?: AppPaths } = {},
): ImportPlan {
  const items = filePaths.map((filePath) => classifyImportFile(filePath, catalog, { paths: options.paths }))
  const review = items.filter((item) =>
    item.classification === 'alt-format' ||
    item.classification === 'collection-overlap' ||
    item.classification === 'revision' ||
    item.classification === 'unsupported',
  ).length
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    trigger: options.trigger ?? 'import',
    folderId: options.folderId,
    expectedCatalogRevision: catalogRevision(catalog),
    items,
    summary: {
      add: items.filter((item) => item.classification === 'new' || item.classification === 'new-style').length,
      install: items.filter((item) => item.classification === 'new' && !item.previewOnly).length,
      unchanged: items.filter((item) => item.classification === 'identical').length,
      review,
      preview: items.filter((item) => item.classification === 'preview-only').length,
    },
  }
}

export function catalogRevision(catalog: CatalogFile): number {
  return catalog.entries.reduce((sum, entry) => sum + (entry.updatedAt || 0), catalog.entries.length)
}

export function planNeedsReview(plan: ImportPlan): boolean {
  return plan.items.some(
    (item) =>
      item.classification === 'alt-format' ||
      item.classification === 'collection-overlap' ||
      item.classification === 'unsupported' ||
      item.parallelCopy === true ||
      (item.classification === 'revision' && item.choices.includes('add-inactive')),
  )
}

export function isWatchIdentityDuplicate(item: ImportPlanItem): boolean {
  return item.classification === 'revision' && item.parallelCopy === true
}

export function savePlan(paths: AppPaths, plan: ImportPlan): ImportPlan {
  const dir = plansDir(paths)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${plan.id}.json`), JSON.stringify(plan, null, 2))
  prunePlans(paths)
  return plan
}

export function loadPlan(paths: AppPaths, id: string): ImportPlan | undefined {
  const file = path.join(plansDir(paths), `${id}.json`)
  if (!fs.existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ImportPlan
    if (!parsed || parsed.id !== id) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function prunePlans(paths: AppPaths): void {
  const dir = plansDir(paths)
  if (!fs.existsSync(dir)) return
  const cutoff = Date.now() - PLAN_TTL_MS
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { createdAt?: number }
      if ((parsed.createdAt ?? 0) < cutoff) {
        fs.rmSync(file, { force: true })
      }
    } catch {
      fs.rmSync(file, { force: true })
    }
  }
}

export function rememberedDecisionKey(item: ImportPlanItem, installationId?: string): string {
  return `${item.fingerprint ?? item.path}:${item.classification}:${installationId ?? item.entryId ?? ''}`
}

export function defaultChoiceForPolicy(
  item: ImportPlanItem,
  policy: { installNew: boolean; autoUpdate: boolean },
): ImportPlanChoice {
  if (item.classification === 'unsupported') return 'skip'
  if (item.classification === 'identical') return 'skip'
  if (item.classification === 'preview-only') return 'keep'
  if (item.classification === 'revision' && item.parallelCopy) return 'skip'
  if (item.classification === 'revision') return policy.autoUpdate ? 'replace' : 'keep'
  if (item.classification === 'new' || item.classification === 'new-style') {
    return policy.installNew ? 'keep' : 'keep'
  }
  return item.defaultChoice
}
