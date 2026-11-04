export const BACKUP_LICENSE_WARNING =
  'This backup contains your font files as well as your library organisation. It can be as large as your whole font library, and it may contain licensed fonts — keep the file private and only restore it on machines your licences cover.'

export const BACKUP_RESTORE_WARNING =
  'This backup may contain licensed fonts — only restore it on machines your licences cover.'

export function formatBackupBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
