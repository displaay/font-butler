export function formatAddedAt(ms: number, locale?: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms))
}
