import fs from 'node:fs'
import path from 'node:path'

export function pathVariants(filePath: string): string[] {
  const resolved = path.resolve(filePath)
  const variants = new Set([resolved])
  try {
    variants.add(fs.realpathSync(resolved))
  } catch {
    try {
      variants.add(path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved)))
    } catch {
      // Keep the lexical path when the target or its parents cannot be resolved.
    }
  }
  return [...variants]
}

function rootVariants(roots: string[]): string[] {
  return [...new Set(roots.flatMap((root) => pathVariants(root)))]
}

function isLexicallyUnder(filePath: string, roots: string[]): boolean {
  return roots.some((base) => filePath === base || filePath.startsWith(base + path.sep))
}

export function isUnderAnyRoot(filePath: string, roots: string[]): boolean {
  const bases = rootVariants(roots)
  return pathVariants(filePath).some((candidate) => isLexicallyUnder(candidate, bases))
}

export function isFullyUnderAnyRoot(filePath: string, roots: string[]): boolean {
  const bases = rootVariants(roots)
  return pathVariants(filePath).every((candidate) => isLexicallyUnder(candidate, bases))
}
