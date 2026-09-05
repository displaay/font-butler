export function missingCodePoints(text: string, characterSet: number[] | undefined): number[] {
  if (!characterSet || characterSet.length === 0) return []
  const available = new Set(characterSet)
  const missing: number[] = []
  const seen = new Set<number>()
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code === undefined) continue
    if (code <= 32) continue
    if (available.has(code) || seen.has(code)) continue
    seen.add(code)
    missing.push(code)
  }
  return missing
}

export function formatMissingCharacters(points: number[]): string {
  return points
    .slice(0, 24)
    .map((point) => {
      try {
        return String.fromCodePoint(point)
      } catch {
        return `U+${point.toString(16).toUpperCase()}`
      }
    })
    .join(' ')
}
