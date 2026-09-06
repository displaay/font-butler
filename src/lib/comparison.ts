import type { CatalogEntry, ComparisonCapture } from './types'

export function canCompareInstalledVsSource(entry: CatalogEntry | null | undefined): boolean {
  if (!entry?.installedPath) return false
  if (entry.sourceAvailability !== 'present') return false
  if (entry.sourcePath === entry.installedPath) return false
  return true
}

export function isComparisonSourceStale(
  capture: ComparisonCapture | null | undefined,
  liveSourceFingerprint: string | undefined,
): boolean {
  if (!capture || !liveSourceFingerprint) return false
  return liveSourceFingerprint !== capture.sourceFingerprint
}

export function capturedFontFamily(id: string, side: 'installed' | 'source'): string {
  return `fc-${id}-captured-${side}`
}
